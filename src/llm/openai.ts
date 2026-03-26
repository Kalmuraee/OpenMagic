import type { ChatMessage, ContentPart, LlmContext } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts.js";

interface OpenAICompatibleRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  stream: boolean;
  max_tokens?: number;
  reasoning_effort?: string;
}

export async function chatOpenAICompatible(
  provider: string,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string }) => void,
  onError: (error: string) => void
): Promise<void> {
  const providerConfig = MODEL_REGISTRY[provider];
  if (!providerConfig) {
    onError(`Unknown provider: ${provider}`);
    return;
  }

  const apiBase = providerConfig.apiBase;
  const url = `${apiBase}/chat/completions`;

  // Build messages with context
  const apiMessages: OpenAICompatibleRequest["messages"] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add context to the first user message
  for (const msg of messages) {
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

      // If we have a screenshot and the model supports vision, add it
      const modelInfo = providerConfig.models.find((m) => m.id === model);
      if (context.screenshot && modelInfo?.vision) {
        apiMessages.push({
          role: "user",
          content: [
            { type: "text", text: enrichedContent },
            {
              type: "image_url",
              image_url: { url: context.screenshot },
            },
          ],
        });
      } else {
        apiMessages.push({ role: "user", content: enrichedContent });
      }
    } else {
      apiMessages.push({
        role: msg.role,
        content: msg.content as string,
      });
    }
  }

  const body: OpenAICompatibleRequest = {
    model,
    messages: apiMessages,
    stream: true,
    max_tokens: 4096,
  };

  // Add thinking/reasoning config if the model supports it
  const modelInfo = providerConfig.models.find((m) => m.id === model);
  if (modelInfo?.thinking?.supported && modelInfo.thinking.paramType === "level") {
    body.reasoning_effort = modelInfo.thinking.defaultLevel || "medium";
    // Reasoning models typically need higher max_tokens
    body.max_tokens = Math.min(modelInfo.maxOutput, 16384);
  }

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
    });

    if (!response.ok) {
      const errorText = await response.text();
      onError(`API error ${response.status}: ${errorText}`);
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
