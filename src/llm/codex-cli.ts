import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

/**
 * OpenAI Codex CLI adapter.
 * Spawns `codex` in quiet mode with the prompt via stdin.
 * Requires OPENAI_API_KEY in the environment — no key entry needed in OpenMagic.
 */

export async function chatCodexCli(
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

  const proc = spawn("codex", ["-q"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
    env: { ...process.env, CODEX_QUIET_MODE: "1" },
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
      onError("Codex CLI not found. Install it with: npm install -g @openai/codex");
    } else {
      onError(`Codex CLI error: ${err.message}`);
    }
  });

  proc.on("close", (code) => {
    if (code === 0 || fullContent) {
      onDone({ content: fullContent });
    } else {
      const err = errOutput.trim();
      if (err.includes("OPENAI_API_KEY") || err.includes("api key") || err.includes("unauthorized")) {
        onError("Codex CLI requires OPENAI_API_KEY in your environment. Set it with: export OPENAI_API_KEY=sk-...");
      } else {
        onError(err.slice(0, 500) || `Codex CLI exited with code ${code}`);
      }
    }
  });
}
