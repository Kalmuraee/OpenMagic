import type { ChatMessage, ContentPart, LlmContext } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

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

  // Only enrich the LAST user message with context (not all historical ones)
  const lastUserIdx = messages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user" && typeof msg.content === "string" && i === lastUserIdx) {
      const enrichedContent = buildUserMessage(msg.content, buildContextParts(context));

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
    } else if (msg.role === "system") {
      continue; // System prompt already added
    } else {
      apiMessages.push({
        role: msg.role,
        content: msg.content as string,
      });
    }
  }

  // GPT-5.x, o3, o4 models require max_completion_tokens instead of max_tokens
  const usesCompletionTokens = provider === "openai" && (
    model.startsWith("gpt-5") || model.startsWith("o3") || model.startsWith("o4") || model.startsWith("codex")
  );

  const body: OpenAICompatibleRequest = {
    model,
    messages: apiMessages,
    stream: true,
  };

  if (usesCompletionTokens) {
    body.max_completion_tokens = 4096;
  } else {
    body.max_tokens = 4096;
  }

  // Add thinking/reasoning config if the model supports it
  const modelInfo = providerConfig.models.find((m) => m.id === model);
  if (modelInfo?.thinking?.supported && modelInfo.thinking.paramType === "level") {
    body.reasoning_effort = modelInfo.thinking.defaultLevel || "medium";
    const limit = Math.min(modelInfo.maxOutput, 16384);
    if (usesCompletionTokens) {
      body.max_completion_tokens = limit;
    } else {
      body.max_tokens = limit;
    }
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
