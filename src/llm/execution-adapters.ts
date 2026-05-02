import type { ChatMessage, LlmContext } from "../shared-types.js";
import { chatAnthropic } from "./anthropic.js";
import { chatClaudeCode } from "./claude-code.js";
import { chatCodexCli } from "./codex-cli.js";
import { chatGeminiCli } from "./gemini-cli.js";
import { chatGoogle } from "./google.js";
import { chatOpenAICompatible } from "./openai.js";

export interface ExecutionAdapter {
  id: string;
  provider: string;
  chat: (
    model: string,
    apiKey: string,
    messages: ChatMessage[],
    context: LlmContext,
    onChunk: (chunk: string) => void,
    onDone: (result: { content: string }) => void,
    onError: (error: string) => void
  ) => Promise<void>;
}

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

export function getExecutionAdapter(provider: string): ExecutionAdapter | null {
  if (provider === "claude-code") {
    return {
      id: "claude-code-cli",
      provider,
      chat: (_model, _apiKey, messages, context, onChunk, onDone, onError) =>
        chatClaudeCode(messages, context, onChunk, onDone, onError),
    };
  }
  if (provider === "codex-cli") {
    return {
      id: "codex-cli",
      provider,
      chat: (_model, _apiKey, messages, context, onChunk, onDone, onError) =>
        chatCodexCli(messages, context, onChunk, onDone, onError),
    };
  }
  if (provider === "gemini-cli") {
    return {
      id: "gemini-cli",
      provider,
      chat: (_model, _apiKey, messages, context, onChunk, onDone, onError) =>
        chatGeminiCli(messages, context, onChunk, onDone, onError),
    };
  }
  if (provider === "anthropic") {
    return { id: "anthropic-messages", provider, chat: chatAnthropic };
  }
  if (provider === "google") {
    return { id: "google-generate-content", provider, chat: chatGoogle };
  }
  if (OPENAI_COMPATIBLE_PROVIDERS.has(provider)) {
    return {
      id: "openai-compatible-chat-completions",
      provider,
      chat: (model, apiKey, messages, context, onChunk, onDone, onError) =>
        chatOpenAICompatible(provider, model, apiKey, messages, context, onChunk, onDone, onError),
    };
  }
  return null;
}

export function isCliProvider(provider: string): boolean {
  return provider === "claude-code" || provider === "codex-cli" || provider === "gemini-cli";
}
