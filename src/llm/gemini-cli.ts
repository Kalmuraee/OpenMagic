import { spawn } from "node:child_process";
import { terminateChildProcessTree } from "./child-process.js";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, NATIVE_EDIT_INSTRUCTION, buildUserMessage, buildContextParts } from "./prompts.js";

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
  onDone: (result: { content: string; truncated?: boolean }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const userPrompt =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : "Help me with this element.";

  const conversationHistory = messages
    .slice(0, Math.max(0, messages.lastIndexOf(lastUserMsg!)))
    .filter((message) => typeof message.content === "string")
    .slice(-20)
    .map((message) => `${message.role.toUpperCase()}: ${message.content as string}`)
    .join("\n\n");

  const contextParts = buildContextParts(context);
  const systemText = context.nativeEdit ? NATIVE_EDIT_INSTRUCTION : SYSTEM_PROMPT;
  const currentPrompt = buildUserMessage(userPrompt, contextParts);
  const conversationPrompt = conversationHistory ? `Previous conversation:\n${conversationHistory}\n\nCurrent request:\n${currentPrompt}` : currentPrompt;
  const fullPrompt = `${systemText}\n\n${conversationPrompt}`;

  // Pipe full prompt via stdin — Gemini CLI auto-detects piped stdin
  // and enters non-interactive headless mode.
  // --yolo: auto-accept all tool actions without prompting
  await new Promise<void>((resolve) => {
  let processSettled = false;
  const settle = () => { if (!processSettled) { processSettled = true; resolve(); } };

  const proc = spawn(
    "gemini",
    [
      "--yolo",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      cwd: context.projectRoot || process.cwd(),
    }
  );

  // Send the complete prompt (system + context + user) via stdin
  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  let aborted = false;
  if (signal) {
    if (signal.aborted) { aborted = true; terminateChildProcessTree(proc); }
    else signal.addEventListener("abort", () => { aborted = true; terminateChildProcessTree(proc); }, { once: true });
  }

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
    settle();
  });

  proc.on("close", (code) => {
    if (aborted) { settle(); return; } // client cancelled — settle without callbacks
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
    settle();
  });
  });
}
