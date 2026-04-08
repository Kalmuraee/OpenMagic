import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

/**
 * Google Gemini CLI adapter.
 * Uses `gemini` with prompt piped via stdin (auto-detected headless mode).
 * Auth: uses GEMINI_API_KEY from env or Google OAuth (if logged in interactively).
 *
 * Docs: https://github.com/google-gemini/gemini-cli
 * When stdin is piped and no -p flag, Gemini CLI auto-enters non-interactive mode.
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

  // Pipe full prompt via stdin — Gemini CLI auto-detects piped stdin
  // and enters non-interactive headless mode.
  // --yolo: auto-accept all tool actions without prompting
  const proc = spawn(
    "gemini",
    [
      "--yolo",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    }
  );

  // Send the complete prompt (system + context + user) via stdin
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
    if (code === 0 || fullContent.trim()) {
      onDone({ content: fullContent });
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
