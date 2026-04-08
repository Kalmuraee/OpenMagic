import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

/**
 * Google Gemini CLI adapter.
 * Spawns `gemini` in pipe mode with the prompt via stdin.
 * Uses the user's existing Google authentication — no API key needed.
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

  const proc = spawn("gemini", [], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  // Send prompt via stdin
  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  let fullContent = "";
  let errOutput = "";

  proc.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    fullContent += text;
    onChunk(text);
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
    if (code === 0 || fullContent) {
      onDone({ content: fullContent });
    } else {
      const err = errOutput.trim();
      if (err.includes("auth") || err.includes("login") || err.includes("credentials")) {
        onError("Gemini CLI requires Google authentication. Run `gemini auth login` in your terminal.");
      } else {
        onError(err.slice(0, 500) || `Gemini CLI exited with code ${code}`);
      }
    }
  });
}
