import type { ChatMessage, LlmContext } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts.js";

export async function chatGoogle(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string }) => void,
  onError: (error: string) => void
): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const contents: Array<{
    role: string;
    parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
  }> = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    const role = msg.role === "assistant" ? "model" : "user";

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

      const enrichedContent = buildUserMessage(msg.content, contextParts);

      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
        { text: enrichedContent },
      ];

      if (context.screenshot) {
        const base64Data = context.screenshot.replace(
          /^data:image\/\w+;base64,/,
          ""
        );
        parts.push({
          inline_data: {
            mime_type: "image/png",
            data: base64Data,
          },
        });
      }

      contents.push({ role, parts });
    } else {
      contents.push({
        role,
        parts: [{ text: msg.content as string }],
      });
    }
  }

  // Check for thinking support
  const providerConfig = MODEL_REGISTRY.google;
  const modelInfo = providerConfig?.models.find((m) => m.id === model);
  const thinkingLevel = modelInfo?.thinking?.defaultLevel;

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: 8192,
  };

  if (thinkingLevel && thinkingLevel !== "none") {
    generationConfig.thinking_level = thinkingLevel.toUpperCase();
  }

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents,
    generationConfig,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        onError("Invalid Google API key. Check your key in Settings.");
      } else if (response.status === 429) {
        onError("Google API rate limit exceeded. Wait a moment and try again.");
      } else {
        onError(`Google API error ${response.status}: ${errorText.slice(0, 200)}`);
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
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullContent += text;
            onChunk(text);
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
