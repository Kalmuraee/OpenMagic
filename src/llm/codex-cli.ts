import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * OpenAI Codex CLI adapter.
 * Codex CLI requires a TTY, so we wrap it with `script` (macOS/Linux)
 * to provide a pseudo-terminal. The prompt is written to a temp file
 * to avoid shell argument length limits.
 */

/** Strip ANSI escape codes and carriage returns from PTY output */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

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

  // Write prompt to temp file (avoids arg length limits)
  const tmpFile = join(tmpdir(), `openmagic-codex-${randomBytes(8).toString("hex")}.txt`);
  writeFileSync(tmpFile, fullPrompt);

  // Codex requires a TTY — wrap with `script` to provide a pseudo-terminal
  let proc;
  if (process.platform === "darwin") {
    // macOS: script -q /dev/null command [args...]
    proc = spawn("script", ["-q", "/dev/null", "codex", "--full-auto", "--quiet", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  } else if (process.platform === "linux") {
    // Linux: script -qc "command" /dev/null
    proc = spawn("script", ["-qc", `codex --full-auto --quiet -`, "/dev/null"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  } else {
    // Fallback: try direct spawn (may fail if codex requires TTY)
    proc = spawn("codex", ["--full-auto", "--quiet", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  }

  let fullContent = "";
  let errOutput = "";

  proc.stdout.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    if (text) {
      fullContent += text;
      onChunk(text);
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    errOutput += data.toString();
  });

  proc.on("error", (err) => {
    try { unlinkSync(tmpFile); } catch {}
    if (err.message.includes("ENOENT")) {
      onError("Codex CLI not found. Install it with: npm install -g @openai/codex");
    } else {
      onError(`Codex CLI error: ${err.message}`);
    }
  });

  proc.on("close", (code) => {
    try { unlinkSync(tmpFile); } catch {}

    if (code === 0 || fullContent.trim()) {
      onDone({ content: fullContent });
    } else {
      const err = stripAnsi(errOutput.trim());
      if (err.includes("OPENAI_API_KEY") || err.includes("api key") || err.includes("unauthorized")) {
        onError("Codex CLI requires OPENAI_API_KEY in your environment. Set it with: export OPENAI_API_KEY=sk-...");
      } else if (err.includes("stdin is not a terminal") || err.includes("not a tty")) {
        onError("Codex CLI requires a terminal. This platform may not support the PTY wrapper. Try using OpenAI provider instead.");
      } else {
        onError(err.slice(0, 500) || `Codex CLI exited with code ${code}`);
      }
    }
  });
}
