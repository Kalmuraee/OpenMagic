import type { ChatMessage, LlmContext } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
}

export async function chatAnthropic(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string }) => void,
  onError: (error: string) => void
): Promise<void> {
  const url = "https://api.anthropic.com/v1/messages";

  const apiMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // System prompt goes in system field

    if (msg.role === "user" && typeof msg.content === "string") {
      const contextParts: Parameters<typeof buildUserMessage>[1] = {};

      if (context.selectedElement) {
        contextParts.selectedElement = context.selectedElement.outerHTML;
      }
      if (context.files && context.files.length > 0) {
        contextParts.filePath = context.files[0].path;
        contextParts.fileContent = context.files[0].content;
      }
      if (context.projectTree) {
        contextParts.projectTree = context.projectTree;
      }
      if (context.networkLogs) {
        contextParts.networkLogs = context.networkLogs
          .map((l) => `${l.method} ${l.url} → ${l.status || "pending"}`)
          .join("\n");
      }
      if (context.consoleLogs) {
        contextParts.consoleLogs = context.consoleLogs
          .map((l) => `[${l.level}] ${l.args.join(" ")}`)
          .join("\n");
      }

      const enrichedContent = buildUserMessage(msg.content, contextParts);

      // If screenshot available, use vision
      if (context.screenshot) {
        const base64Data = context.screenshot.replace(
          /^data:image\/\w+;base64,/,
          ""
        );
        apiMessages.push({
          role: "user",
          content: [
            { type: "text", text: enrichedContent },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
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

  // Build body with optional extended thinking
  const providerConfig = MODEL_REGISTRY.anthropic;
  const modelInfo = providerConfig?.models.find((m) => m.id === model);
  const thinkingBudget = modelInfo?.thinking?.defaultBudget || 0;

  const body: Record<string, unknown> = {
    model,
    max_tokens: thinkingBudget > 0 ? Math.max(thinkingBudget + 4096, 16384) : 4096,
    system: SYSTEM_PROMPT,
    messages: apiMessages,
    stream: true,
  };

  // Add extended thinking if supported
  if (thinkingBudget > 0) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      onError(`Anthropic API error ${response.status}: ${errorText}`);
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
        } catch {
          // Skip malformed chunks
        }
      }
    }

    onDone({ content: fullContent });
  } catch (e: unknown) {
    onError(`Request failed: ${(e as Error).message}`);
  }
}
