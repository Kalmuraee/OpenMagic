import type { ChatMessage, LlmContext, LlmResponse } from "../shared-types.js";
import { invalidateCliCache } from "./cli-detect.js";
import { getExecutionAdapter } from "./execution-adapters.js";

interface LlmChatParams {
  provider: string;
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  context: LlmContext;
}

function extractJsonFromResponse(content: string): string | null {
  // 1. Try direct JSON.parse (clean response)
  try { JSON.parse(content); return content; } catch {}

  // 2. Try markdown-wrapped JSON
  const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch?.[1]) {
    const candidate = mdMatch[1].trim();
    try { JSON.parse(candidate); return candidate; } catch {}
  }

  // 3. Brace-counting extraction (handles raw JSON in text)
  const start = content.indexOf('{');
  if (start === -1) return null;

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
        try { JSON.parse(candidate); return candidate; } catch { break; }
      }
    }
  }

  // 4. Truncation repair: if braces are imbalanced, try closing them
  if (depth > 0) {
    let repaired = content.substring(start);
    // Close open strings
    if (inString) repaired += '"';
    // Close open arrays and objects
    while (depth > 0) { repaired += '}'; depth--; }
    try { JSON.parse(repaired); return repaired; } catch {}
  }

  // 5. Regex fallback: extract just the explanation field
  const explMatch = content.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (explMatch) {
    return JSON.stringify({ modifications: [], explanation: JSON.parse('"' + explMatch[1] + '"') });
  }

  return null;
}

export async function handleLlmChat(
  params: LlmChatParams,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string; modifications?: LlmResponse["modifications"] }) => void,
  onError: (error: string) => void
): Promise<void> {
  const { provider, model, apiKey, messages, context } = params;

  const wrappedOnDone = (result: { content: string }) => {
    let modifications: LlmResponse["modifications"] | undefined;
    try {
      const json = extractJsonFromResponse(result.content);
      if (json) {
        const parsed = JSON.parse(json) as LlmResponse;
        modifications = parsed.modifications;
      }
    } catch {
      // JSON parse failed — return raw content
    }
    onDone({ content: result.content, modifications });
  };

  // Wrap CLI error handlers to invalidate detection cache on failure
  const cliOnError = (error: string) => {
    if (error.includes("not found") || error.includes("ENOENT") || error.includes("not authenticated") || error.includes("not logged in")) {
      invalidateCliCache();
    }
    onError(error);
  };

  try {
    const adapter = getExecutionAdapter(provider);
    if (!adapter) {
      onError(`Unsupported provider: ${provider}. Check your Settings.`);
      return;
    }
    const adapterOnError = adapter.id.endsWith("-cli") ? cliOnError : onError;
    await adapter.chat(model, apiKey, messages, context, onChunk, wrappedOnDone, adapterOnError);
  } catch (e: unknown) {
    const msg = (e as Error).message || "Unknown error";
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
      onError(`Network error: Could not reach the ${provider} API. Check your internet connection.`);
    } else {
      onError(`Unexpected error with ${provider}: ${msg}`);
    }
  }
}
