import type { ChatMessage, LlmContext, ModelInfo } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";
import { resolveMaxOutput, resolveThinkingBudget } from "./thinking.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
}


function contextImages(context: LlmContext): string[] {
  return [...new Set([context.screenshot, ...(context.attachments || [])].filter((value): value is string => !!value))];
}
export function buildAnthropicRequest(
  model: string,
  messages: ChatMessage[],
  context: LlmContext,
  modelInfoOverride?: ModelInfo
): Record<string, unknown> {
  const apiMessages: AnthropicMessage[] = [];
  const lastUserIdx = messages.reduce((acc, message, index) => message.role === "user" ? index : acc, -1);

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "system") continue;

    if (message.role === "user" && typeof message.content === "string" && index === lastUserIdx) {
      const enrichedContent = buildUserMessage(message.content, buildContextParts(context));
      const images = contextImages(context);
      if (images.length) {
        const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [
          { type: "text", text: enrichedContent },
        ];
        for (const image of images) {
          const mimeMatch = image.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
          const mediaType = mimeMatch?.[1] || "image/png";
          const base64Data = image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
          content.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data },
          });
        }
        apiMessages.push({ role: "user", content });
      } else {
        apiMessages.push({ role: "user", content: enrichedContent });
      }
    } else {
      apiMessages.push({
        role: message.role as "user" | "assistant",
        content: message.content as string,
      });
    }
  }

  const providerConfig = MODEL_REGISTRY.anthropic;
  const modelInfo = modelInfoOverride ?? providerConfig?.models.find((candidate) => candidate.id === model);
  const maxOut = resolveMaxOutput(modelInfo);
  const thinkingBudget = resolveThinkingBudget(context, modelInfo);
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxOut,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: apiMessages,
    stream: true,
  };
  if (thinkingBudget > 0) body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  return body;
}

export async function chatAnthropic(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string; truncated?: boolean }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const url = "https://api.anthropic.com/v1/messages";

  const body = buildAnthropicRequest(model, messages, context);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        onError("Invalid Anthropic API key. Check your key in Settings.");
      } else if (response.status === 429) {
        onError("Anthropic rate limit exceeded. Wait a moment and try again.");
      } else {
        onError(`Anthropic API error ${response.status}: ${errorText.slice(0, 200)}`);
      }
      return;
    }

    if (!response.body) {
      onError("No response body");
      return;
    }

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

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta") {
            const delta = parsed.delta?.text;
            if (delta) {
              fullContent += delta;
              onChunk(delta);
            }
          }
          // Output budget hit before completion (message_delta carries stop_reason).
          if (parsed.delta?.stop_reason === "max_tokens" || parsed.message?.stop_reason === "max_tokens") {
            truncated = true;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    // OPENMAGIC_FINAL_SSE_FLUSH
    buffer += decoder.decode();
    for (const trailingBlock of buffer.split("\n\n")) {
      const dataLine = trailingBlock.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine.slice(6).trim());
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && typeof parsed.delta.text === "string") {
          fullContent += parsed.delta.text;
          onChunk(parsed.delta.text);
        }
        if (parsed.type === "message_delta" && parsed.delta?.stop_reason === "max_tokens") truncated = true;
      } catch {}
    }
    onDone({ content: fullContent, truncated });
  } catch (e: unknown) {
    if (signal?.aborted || (e as Error).name === "AbortError") return; // client cancelled
    onError(`Request failed: ${(e as Error).message}`);
  }
}
