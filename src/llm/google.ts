import type { ChatMessage, LlmContext, ModelInfo } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";
import { mapGoogleThinkingLevel, resolveMaxOutput, resolveReasoningLevel } from "./thinking.js";

export function buildGoogleRequest(
  model: string,
  messages: ChatMessage[],
  context: LlmContext,
  modelInfoOverride?: ModelInfo
): Record<string, unknown> {
  const contents: Array<{
    role: string;
    parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
  }> = [];

  const lastUserIdx = messages.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;

    const role = msg.role === "assistant" ? "model" : "user";

    if (msg.role === "user" && typeof msg.content === "string" && i === lastUserIdx) {
      const enrichedContent = buildUserMessage(msg.content, buildContextParts(context));

      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
        { text: enrichedContent },
      ];

      const images = [...new Set([context.screenshot, ...(context.attachments || [])].filter((value): value is string => !!value))];
      for (const image of images) {
        const mimeMatch = image.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
        const mimeType = mimeMatch?.[1] || "image/png";
        const base64Data = image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
        parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
      }

      contents.push({ role, parts });
    } else {
      contents.push({
        role,
        parts: [{ text: msg.content as string }],
      });
    }
  }

  const providerConfig = MODEL_REGISTRY.google;
  const modelInfo = modelInfoOverride ?? providerConfig?.models.find((m) => m.id === model);

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: resolveMaxOutput(modelInfo),
  };

  const level = modelInfo?.thinking?.paramType === "level"
    ? resolveReasoningLevel(context, modelInfo)
    : undefined;
  const thinkingLevel = level ? mapGoogleThinkingLevel(level) : undefined;

  const body: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents,
    generationConfig,
  };
  if (thinkingLevel) {
    if (model.startsWith("gemini-2.5")) {
      const budget = thinkingLevel === "none" ? 0 : thinkingLevel === "low" ? 1024 : thinkingLevel === "medium" ? 4096 : 8192;
      generationConfig.thinkingConfig = { thinkingBudget: budget };
    } else {
      generationConfig.thinkingConfig = { thinkingLevel };
    }
  }

  return body;
}

export async function chatGoogle(
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string; truncated?: boolean }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const body = buildGoogleRequest(model, messages, context);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
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
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullContent += text;
            onChunk(text);
          }
          // Output budget hit before completion.
          if (parsed.candidates?.[0]?.finishReason === "MAX_TOKENS") truncated = true;
        } catch {
          // Skip malformed chunks
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const finalLine = buffer.trim();
      const data = finalLine.startsWith("data: ") ? finalLine.slice(6).trim() : "";
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const parts = parsed.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (typeof part?.text === "string") { fullContent += part.text; onChunk(part.text); }
          }
          if (parsed.candidates?.[0]?.finishReason === "MAX_TOKENS") truncated = true;
        } catch {}
      }
    }
    onDone({ content: fullContent, truncated });
  } catch (e: unknown) {
    if (signal?.aborted || (e as Error).name === "AbortError") return; // client cancelled
    onError(`Request failed: ${(e as Error).message}`);
  }
}
