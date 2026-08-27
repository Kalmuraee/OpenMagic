import type { ChatMessage, LlmContext, ModelInfo } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";
import { mapOpenAiEffort, resolveMaxOutput, resolveReasoningLevel } from "./thinking.js";

interface OpenAICompatibleRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  stream: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: string;
}


function contextImages(context: LlmContext): string[] {
  return [...new Set([context.screenshot, ...(context.attachments || [])].filter((value): value is string => !!value))];
}
export function buildOpenAICompatibleRequest(
  provider: string,
  model: string,
  messages: ChatMessage[],
  context: LlmContext,
  modelInfoOverride?: ModelInfo
): OpenAICompatibleRequest {
  const providerConfig = MODEL_REGISTRY[provider];
  const modelInfo = modelInfoOverride ?? providerConfig?.models.find((m) => m.id === model);

  const apiMessages: OpenAICompatibleRequest["messages"] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Only enrich the LAST user message with context (not all historical ones)
  const lastUserIdx = messages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user" && typeof msg.content === "string" && i === lastUserIdx) {
      const enrichedContent = buildUserMessage(msg.content, buildContextParts(context));

      const images = modelInfo?.vision ? contextImages(context) : [];
      if (images.length) {
        apiMessages.push({
          role: "user",
          content: [
            { type: "text", text: enrichedContent },
            ...images.map((image) => ({ type: "image_url", image_url: { url: image } })),
          ],
        });
      } else {
        apiMessages.push({ role: "user", content: enrichedContent });
      }
    } else if (msg.role === "system") {
      continue; // System prompt already added
    } else {
      apiMessages.push({
        role: msg.role,
        content: msg.content as string,
      });
    }
  }

  // GPT-5.x, o3, o4 models require max_completion_tokens instead of max_tokens.
  const usesCompletionTokens = provider === "openai" && (
    model.startsWith("gpt-5") || model.startsWith("o3") || model.startsWith("o4") || model.startsWith("codex")
  );

  const body: OpenAICompatibleRequest = {
    model,
    messages: apiMessages,
    stream: true,
  };

  // Allow the model its full output budget (was hardcoded to 4096), so multi-file
  // edits don't get cut off mid-JSON. max_tokens is a ceiling, not a reservation.
  const maxOut = resolveMaxOutput(modelInfo);
  if (usesCompletionTokens) {
    body.max_completion_tokens = maxOut;
  } else {
    body.max_tokens = maxOut;
  }

  if (modelInfo?.thinking?.paramType === "level") {
    const level = resolveReasoningLevel(context, modelInfo);
    const effort = level ? mapOpenAiEffort(level) : undefined;
    if (effort) body.reasoning_effort = effort;
  }

  return body;
}

export async function chatOpenAICompatible(
  provider: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string; truncated?: boolean }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const providerConfig = MODEL_REGISTRY[provider];
  if (!providerConfig) {
    onError(`Unknown provider: ${provider}`);
    return;
  }

  const apiBase = providerConfig.apiBase;
  const url = `${apiBase}/chat/completions`;

  const body = buildOpenAICompatibleRequest(provider, model, messages, context);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (provider === "ollama") {
      // Ollama doesn't need auth
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        onError(`Invalid API key for ${providerConfig.name}. Check your key in Settings.`);
      } else if (response.status === 429) {
        onError(`Rate limit exceeded for ${providerConfig.name}. Wait a moment and try again.`);
      } else {
        onError(`${providerConfig.name} API error ${response.status}: ${errorText.slice(0, 200)}`);
      }
      return;
    }

    if (!response.body) {
      onError("No response body");
      return;
    }

    // Stream SSE response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onChunk(delta);
          }
          // Output budget hit before the model finished — content is incomplete.
          if (parsed.choices?.[0]?.finish_reason === "length") truncated = true;
        } catch {
          // Skip malformed chunks
        }
      }
    }

    // OPENMAGIC_FINAL_SSE_FLUSH: TextDecoder can retain bytes and an SSE
    // server is not required to terminate its last record with a newline.
    buffer += decoder.decode();
    for (const trailingLine of buffer.split("\n")) {
      if (!trailingLine.startsWith("data: ")) continue;
      const data = trailingLine.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) { fullContent += delta; onChunk(delta); }
        const reason = parsed.choices?.[0]?.finish_reason;
        if (reason === "length" || reason === "max_tokens") truncated = true;
      } catch {}
    }
    onDone({ content: fullContent, truncated });
  } catch (e: unknown) {
    if (signal?.aborted || (e as Error).name === "AbortError") return; // client cancelled
    onError(`Request failed: ${(e as Error).message}`);
  }
}
