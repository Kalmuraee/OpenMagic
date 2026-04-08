import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

/**
 * Google Gemini CLI adapter.
 * Uses `gemini -p` (non-interactive/headless mode) with stream-json output.
 * Auth: uses GEMINI_API_KEY from env or Google OAuth (if logged in interactively).
 *
 * Docs: https://github.com/google-gemini/gemini-cli
 * Flags verified from packages/cli/src/config/config.ts
 */

export async function chatGeminiCli(
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string }) => void,
  onError: (error: string) => void
): Promise<void> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const userPrompt =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : "Help me with this element.";

  const contextParts = buildContextParts(context);
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${buildUserMessage(userPrompt, contextParts)}`;

  // gemini -p: non-interactive/headless mode (no TTY required)
  // --output-format stream-json: structured streaming output
  // --yolo: auto-accept all actions
  // Prompt is piped via stdin (auto-detected when stdin is not a TTY,
  // prepended to -p prompt)
  const proc = spawn(
    "gemini",
    [
      "-p", userPrompt,
      "--output-format", "stream-json",
      "--yolo",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    }
  );

  // Send full context (system prompt + grounded files) via stdin
  // Gemini CLI prepends stdin content to the -p prompt
  proc.stdin.write(`${SYSTEM_PROMPT}\n\n${buildUserMessage("", contextParts)}`);
  proc.stdin.end();

  let fullContent = "";
  let resultContent = "";
  let buffer = "";
  let errOutput = "";

  proc.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        // Final result event
        if (event.type === "result") {
          if (typeof event.result === "string") {
            resultContent = event.result;
          }
          continue;
        }

        const text = extractGeminiText(event);
        if (text) {
          fullContent += text;
          onChunk(text);
        }
      } catch {
        // Not JSON — treat as raw text
        const trimmed = line.trim();
        if (trimmed) {
          fullContent += trimmed + "\n";
          onChunk(trimmed + "\n");
        }
      }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    errOutput += data.toString();
  });

  proc.on("error", (err) => {
    if (err.message.includes("ENOENT")) {
      onError("Gemini CLI not found. Install it with: npm install -g @google/gemini-cli");
    } else {
      onError(`Gemini CLI error: ${err.message}`);
    }
  });

  proc.on("close", (code) => {
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        if (event.type === "result" && typeof event.result === "string") {
          resultContent = event.result;
        } else {
          const text = extractGeminiText(event);
          if (text) fullContent += text;
        }
      } catch {
        const trimmed = buffer.trim();
        if (trimmed) fullContent += trimmed;
      }
    }

    const finalContent = resultContent || fullContent;

    if (code === 0 || finalContent.trim()) {
      onDone({ content: finalContent });
    } else {
      const err = errOutput.trim();
      if (err.includes("auth") || err.includes("GEMINI_API_KEY") || err.includes("credentials") || err.includes("login")) {
        onError("Gemini CLI requires authentication. Set GEMINI_API_KEY in your environment, or run `gemini` interactively to log in with Google.");
      } else {
        onError(err.slice(0, 500) || `Gemini CLI exited with code ${code}`);
      }
    }
  });
}

/**
 * Extract text from a Gemini CLI stream-json event.
 * Gemini CLI uses similar event formats to other AI CLIs.
 */
function extractGeminiText(event: Record<string, unknown>): string | undefined {
  // Assistant message with content blocks
  if (event.type === "assistant" || event.type === "message") {
    const content = (event as any).content ?? (event as any).message?.content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === "text" && b.text)
        .map((b: any) => b.text)
        .join("");
    }
    if (typeof content === "string") return content;
    if (typeof (event as any).text === "string") return (event as any).text;
  }

  // Content block delta (streaming chunks)
  if (event.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (typeof delta?.text === "string") return delta.text;
  }

  return undefined;
}
