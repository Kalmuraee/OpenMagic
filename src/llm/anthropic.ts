import type { ChatMessage, LlmContext, ModelInfo } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";
import { resolveMaxOutput, resolveThinkingBudget } from "./thinking.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
}

export function buildAnthropicRequest(
  model: string,
  messages: ChatMessage[],
  context: LlmContext,
  modelInfoOverride?: ModelInfo
): Record<string, unknown> {
  const apiMessages: AnthropicMessage[] = [];
  const lastUserIdx = messages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;

    if (msg.role === "user" && typeof msg.content === "string" && i === lastUserIdx) {
      const enrichedContent = buildUserMessage(msg.content, buildContextParts(context));

      // If screenshot available, use vision. Accept data: URLs and bare base64.
      if (context.screenshot) {
        const mimeMatch = context.screenshot.match(/^data:(image\/[a-z+]+);base64,/);
        const mediaType = mimeMatch?.[1] || "image/png";
        const base64Data = context.screenshot.replace(/^data:image\/[a-z+]+;base64,/, "");
        apiMessages.push({
          role: "user",
          content: [
            { type: "text", text: enrichedContent },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as any,
                data: base64Data,
              },
            },
          ],
        });
      } else {
        apiMessages.push({ role: "user", content: enrichedContent });
      }
    } else {
      apiMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content as string,
      });
    }
  }

  const providerConfig = MODEL_REGISTRY.anthropic;
  const modelInfo = modelInfoOverride ?? providerConfig?.models.find((m) => m.id === model);

  // Full output budget; thinking budget is clamped to stay strictly below it.
  const maxOut = resolveMaxOutput(modelInfo);
  const thinkingBudget = resolveThinkingBudget(context, modelInfo);

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxOut,
    // Prompt caching: the large, stable system prompt is cached across every turn
    // of a conversation / retry loop (~90% cheaper + faster on cache hits). OpenAI
    // caches automatically; Anthropic needs this explicit cache_control marker.
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: apiMessages,
    stream: true,
  };

  if (thinkingBudget > 0) {
    body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  }

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

    onDone({ content: fullContent, truncated });
  } catch (e: unknown) {
    if (signal?.aborted || (e as Error).name === "AbortError") return; // client cancelled
    onError(`Request failed: ${(e as Error).message}`);
  }
}
