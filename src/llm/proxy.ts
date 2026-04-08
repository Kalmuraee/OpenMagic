import type { ChatMessage, LlmContext, LlmResponse } from "../shared-types.js";
import { chatOpenAICompatible } from "./openai.js";
import { chatAnthropic } from "./anthropic.js";
import { chatGoogle } from "./google.js";
import { chatClaudeCode } from "./claude-code.js";
import { chatCodexCli } from "./codex-cli.js";
import { chatGeminiCli } from "./gemini-cli.js";
import { invalidateCliCache } from "./cli-detect.js";

// Providers that use OpenAI-compatible API format
const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  "openai",
  "deepseek",
  "groq",
  "mistral",
  "xai",
  "ollama",
  "openrouter",
  "minimax",
  "moonshot",
  "qwen",
  "zhipu",
  "doubao",
]);

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
    if (provider === "claude-code") {
      await chatClaudeCode(messages, context, onChunk, wrappedOnDone, cliOnError);
    } else if (provider === "codex-cli") {
      await chatCodexCli(messages, context, onChunk, wrappedOnDone, cliOnError);
    } else if (provider === "gemini-cli") {
      await chatGeminiCli(messages, context, onChunk, wrappedOnDone, cliOnError);
    } else if (provider === "anthropic") {
      await chatAnthropic(model, apiKey, messages, context, onChunk, wrappedOnDone, onError);
    } else if (provider === "google") {
      await chatGoogle(model, apiKey, messages, context, onChunk, wrappedOnDone, onError);
    } else if (OPENAI_COMPATIBLE_PROVIDERS.has(provider)) {
      await chatOpenAICompatible(
        provider,
        model,
        apiKey,
        messages,
        context,
        onChunk,
        wrappedOnDone,
        onError
      );
    } else {
      onError(`Unsupported provider: ${provider}. Check your Settings.`);
    }
  } catch (e: unknown) {
    const msg = (e as Error).message || "Unknown error";
    if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
      onError(`Network error: Could not reach the ${provider} API. Check your internet connection.`);
    } else {
      onError(`Unexpected error with ${provider}: ${msg}`);
    }
  }
}
