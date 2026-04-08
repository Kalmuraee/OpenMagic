import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

/**
 * Claude Code CLI adapter.
 * Spawns `claude -p` with the prompt and streams the response.
 * No API key needed — uses the user's existing Claude Code authentication.
 */

/**
 * Check if the `claude` CLI is available in PATH.
 */
export function isClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

export async function chatClaudeCode(
  messages: ChatMessage[],
  context: LlmContext,
  onChunk: (chunk: string) => void,
  onDone: (result: { content: string }) => void,
  onError: (error: string) => void
): Promise<void> {
  // Build the prompt the same way as other providers
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const userPrompt =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : "Help me with this element.";

  const contextParts = buildContextParts(context);
  const fullPrompt = buildUserMessage(userPrompt, contextParts);

  // Spawn claude -p with stream-json for real-time streaming
  const proc = spawn(
    "claude",
    [
      "-p",
      "--output-format", "stream-json",
      "--max-turns", "1", // Single turn — OpenMagic manages its own retry loop
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    }
  );

  // Send system prompt + user prompt via stdin
  proc.stdin.write(`${SYSTEM_PROMPT}\n\n${fullPrompt}`);
  proc.stdin.end();

  let fullContent = "";
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
        const text = extractText(event);
        if (text) {
          fullContent += text;
          onChunk(text);
        }
      } catch {
        // Not valid JSON — skip
      }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    errOutput += data.toString();
  });

  proc.on("error", (err) => {
    if (err.message.includes("ENOENT")) {
      onError(
        "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
      );
    } else {
      onError(`Claude CLI error: ${err.message}`);
    }
  });

  proc.on("close", (code) => {
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        const text = extractText(event);
        if (text) fullContent += text;
        // Check for final result event
        if (event.result && typeof event.result === "string") {
          fullContent = event.result;
        }
      } catch {
        // ignore
      }
    }

    if (code === 0 || fullContent) {
      onDone({ content: fullContent });
    } else {
      // Parse common errors
      const err = errOutput.trim();
      if (err.includes("not authenticated") || err.includes("login")) {
        onError("Claude CLI is not authenticated. Run `claude login` in your terminal.");
      } else if (err.includes("ENOENT") || err.includes("not found")) {
        onError("Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code");
      } else {
        onError(err.slice(0, 500) || `Claude CLI exited with code ${code}`);
      }
    }
  });
}

/**
 * Extract text content from a stream-json event.
 * Handles multiple possible event formats robustly.
 */
function extractText(event: Record<string, unknown>): string | undefined {
  // Format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
  if (event.type === "assistant") {
    const msg = event.message as Record<string, unknown> | undefined;
    if (msg?.content) {
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((b: any) => b.type === "text" && b.text)
          .map((b: any) => b.text)
          .join("");
      }
      if (typeof msg.content === "string") return msg.content;
    }
    // Format: {"type":"assistant","text":"..."}
    if (typeof event.text === "string") return event.text;
  }

  // Format: {"type":"content_block_delta","delta":{"text":"..."}}
  if (event.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (typeof delta?.text === "string") return delta.text;
  }

  return undefined;
}
