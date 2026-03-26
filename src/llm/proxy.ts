import type { ChatMessage, LlmContext, LlmResponse } from "../shared-types.js";
import { chatOpenAICompatible } from "./openai.js";
import { chatAnthropic } from "./anthropic.js";
import { chatGoogle } from "./google.js";

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

export async function handleLlmChat(
  params: LlmChatParams,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string; modifications?: LlmResponse["modifications"] }) => void,
  onError: (error: string) => void
): Promise<void> {
  const { provider, model, apiKey, messages, context } = params;

  const wrappedOnDone = (result: { content: string }) => {
    // Try to parse modifications from the response
    let modifications: LlmResponse["modifications"] | undefined;
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = result.content.match(/```json\s*([\s\S]*?)```/) ||
        result.content.match(/\{[\s\S]*"modifications"[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr) as LlmResponse;
        modifications = parsed.modifications;
      }
    } catch {
      // If parsing fails, just return the raw content
    }

    onDone({ content: result.content, modifications });
  };

  try {
    if (provider === "anthropic") {
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
