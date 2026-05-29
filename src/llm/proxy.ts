import type {
  ChatMessage,
  CodeModification,
  LlmContext,
  LlmResponse,
  ParseStatus,
} from "../shared-types.js";
import { invalidateCliCache } from "./cli-detect.js";
import { getExecutionAdapter } from "./execution-adapters.js";
import { sanitizeHistory } from "./history.js";
import { MODEL_REGISTRY } from "./registry.js";
import {
  AnthropicToolDriver,
  GoogleToolDriver,
  OpenAiToolDriver,
  runToolLoop,
  type ToolDriver,
} from "./tool-loop.js";
import { executeServerTool } from "./tools.js";

interface LlmChatParams {
  provider: string;
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  context: LlmContext;
  useTools?: boolean; // opt-in: route tool-capable providers through native tool-calling
  root?: string;      // project root, required for tool execution
}

// Providers whose APIs support native tool-calling (H11). The OpenAI-compatible
// set covers the majority; Anthropic and Google have their own drivers.
const OPENAI_TOOL_PROVIDERS = new Set([
  "openai", "deepseek", "groq", "mistral", "xai", "openrouter",
  "minimax", "moonshot", "qwen", "zhipu", "doubao",
]);

export function toolCapableProvider(provider: string): boolean {
  return provider === "anthropic" || provider === "google" || OPENAI_TOOL_PROVIDERS.has(provider);
}

function buildToolDriver(
  provider: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext
): ToolDriver | null {
  const reg = MODEL_REGISTRY[provider];
  const modelInfo = reg?.models.find((m) => m.id === model);
  if (provider === "anthropic") return new AnthropicToolDriver(model, apiKey, modelInfo, messages, context);
  if (provider === "google") return new GoogleToolDriver(model, apiKey, messages, context);
  if (OPENAI_TOOL_PROVIDERS.has(provider) && reg) {
    return new OpenAiToolDriver(reg.apiBase, model, apiKey, provider, modelInfo, messages, context);
  }
  return null;
}

export interface ParsedLlmResponse {
  status: ParseStatus;
  json: string | null;
  modifications: CodeModification[];
  explanation: string;
}

// Extracts a JSON object from a (possibly messy) LLM response and reports HOW it
// was recovered, so callers can tell a genuine "no change" from a stream that was
// cut mid-array. A `clean` result is fully trustworthy; `truncated`/`salvaged`
// mean modifications may be incomplete or lost.
function extractWithStatus(content: string): { json: string | null; status: ParseStatus } {
  // 1. Direct JSON.parse (clean response)
  try { JSON.parse(content); return { json: content, status: "clean" }; } catch {}

  // 2. Markdown-wrapped JSON (still a complete object → clean)
  const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch?.[1]) {
    const candidate = mdMatch[1].trim();
    try { JSON.parse(candidate); return { json: candidate, status: "clean" }; } catch {}
  }

  // 3. Brace-counting extraction (balanced object embedded in prose → clean)
  const start = content.indexOf('{');
  if (start === -1) return { json: null, status: "failed" };

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = content.substring(start, i + 1);
        try { JSON.parse(candidate); return { json: candidate, status: "clean" }; } catch { break; }
      }
    }
  }

  // 4. Truncation repair: stream cut mid-object — close strings/braces (→ truncated)
  if (depth > 0) {
    let repaired = content.substring(start);
    if (inString) repaired += '"';
    while (depth > 0) { repaired += '}'; depth--; }
    try { JSON.parse(repaired); return { json: repaired, status: "truncated" }; } catch {}
  }

  // 5. Regex fallback: only the explanation survives — modifications are lost (→ salvaged)
  const explMatch = content.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (explMatch) {
    return {
      json: JSON.stringify({ modifications: [], explanation: JSON.parse('"' + explMatch[1] + '"') }),
      status: "salvaged",
    };
  }

  return { json: null, status: "failed" };
}

export function extractJsonFromResponse(content: string): string | null {
  return extractWithStatus(content).json;
}

// Full parse with an honest status. Modifications/explanation are extracted from
// whatever JSON could be recovered; callers should surface non-"clean" statuses
// to the user instead of treating a salvaged/truncated/failed parse as success.
export function parseLlmResponse(content: string): ParsedLlmResponse {
  const { json, status } = extractWithStatus(content);
  let modifications: CodeModification[] = [];
  let explanation = "";
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<LlmResponse>;
      if (Array.isArray(parsed.modifications)) modifications = parsed.modifications;
      if (typeof parsed.explanation === "string") explanation = parsed.explanation;
    } catch {
      // recovered string was still not parseable — leave defaults
    }
  }
  return { status, json, modifications, explanation };
}

export async function handleLlmChat(
  params: LlmChatParams,
  onChunk: (chunk: string) => void,
  onDone: (result: {
    content: string;
    modifications?: LlmResponse["modifications"];
    parseStatus?: ParseStatus;
  }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const { provider, model, apiKey, context } = params;
  // Strip UI sentinels and fold load-bearing feedback (rejections, failed
  // matches, verify errors) into the current user turn so it survives the
  // system-drop in every adapter and reaches CLI agents.
  const messages = sanitizeHistory(params.messages);

  const wrappedOnDone = (result: { content: string; truncated?: boolean }) => {
    const parsed = parseLlmResponse(result.content);
    // A length-capped stream is truncated even if the partial JSON happened to
    // parse — trust the adapter's finish-reason signal over the parser.
    const parseStatus = result.truncated ? "truncated" : parsed.status;
    onDone({
      content: result.content,
      modifications: parsed.modifications,
      parseStatus,
    });
  };

  // Wrap CLI error handlers to invalidate detection cache on failure
  const cliOnError = (error: string) => {
    if (error.includes("not found") || error.includes("ENOENT") || error.includes("not authenticated") || error.includes("not logged in")) {
      invalidateCliCache();
    }
    onError(error);
  };

  try {
    // H11: native tool-calling path (opt-in, tool-capable API providers). The
    // model reads exact file contents via tools and proposes edits against code
    // it actually saw. Falls through to the JSON-string contract on any failure.
    if (params.useTools && params.root && toolCapableProvider(provider)) {
      const driver = buildToolDriver(provider, model, apiKey, messages, context);
      if (driver) {
        try {
          const result = await runToolLoop(
            driver,
            (name, args) => executeServerTool(name, args, params.root!, [params.root!]),
            { signal }
          );
          if (signal?.aborted) return;
          onDone({ content: result.content, modifications: result.modifications, parseStatus: "clean" });
          return;
        } catch (e) {
          if (signal?.aborted || (e as Error).name === "AbortError") return;
          // tool-calling failed — fall back to the streamed JSON-string path
        }
      }
    }

    const adapter = getExecutionAdapter(provider);
    if (!adapter) {
      onError(`Unsupported provider: ${provider}. Check your Settings.`);
      return;
    }
    const adapterOnError = adapter.id.endsWith("-cli") ? cliOnError : onError;
    await adapter.chat(model, apiKey, messages, context, onChunk, wrappedOnDone, adapterOnError, signal);
  } catch (e: unknown) {
    if (signal?.aborted || (e as Error).name === "AbortError") return; // client cancelled
    const msg = (e as Error).message || "Unknown error";
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
      onError(`Network error: Could not reach the ${provider} API. Check your internet connection.`);
    } else {
      onError(`Unexpected error with ${provider}: ${msg}`);
    }
  }
}
