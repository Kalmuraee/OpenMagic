import { spawn } from "node:child_process";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, buildUserMessage, buildContextParts } from "./prompts.js";

/**
 * OpenAI Codex CLI adapter.
 * Uses `codex exec` — the non-interactive subcommand (no TTY required).
 * Streams JSONL events via --json flag.
 * Auth: uses OPENAI_API_KEY from env or codex's own auth.
 *
 * Docs: https://github.com/openai/codex
 * Event types verified from codex-rs/exec/src/exec_events.rs
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

  // `codex exec` is the non-interactive subcommand (no TTY required)
  // --full-auto: auto-approve actions (alias for --sandbox workspace-write)
  // --json: structured JSONL output to stdout
  // --skip-git-repo-check: allow running outside git repos
  // - : read prompt from stdin
  const proc = spawn(
    "codex",
    ["exec", "--full-auto", "--json", "--skip-git-repo-check", "-"],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    }
  );

  proc.stdin.write(fullPrompt);
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
        const text = extractCodexText(event);
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
      onError("Codex CLI not found. Install it with: npm install -g @openai/codex");
    } else {
      onError(`Codex CLI error: ${err.message}`);
    }
  });

  proc.on("close", (code) => {
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        const text = extractCodexText(event);
        if (text) fullContent += text;
      } catch {
        // ignore
      }
    }

    if (code === 0 || fullContent.trim()) {
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

/**
 * Extract text from a Codex JSONL event.
 *
 * Codex exec --json emits these event types:
 * - item.started / item.updated / item.completed with item payload
 * - Item types: agent_message (text), reasoning (text), command_execution, file_change, etc.
 * - turn.started / turn.completed / turn.failed
 * - thread.started
 * - error
 *
 * We extract text from agent_message items.
 */
function extractCodexText(event: Record<string, unknown>): string | undefined {
  // item.completed or item.updated with agent_message
  if (
    event.type === "item.completed" ||
    event.type === "item.updated" ||
    event.type === "item.started"
  ) {
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      return item.text;
    }
  }

  // Error event
  if (event.type === "error" && typeof (event as any).message === "string") {
    return undefined; // Don't stream errors as content
  }

  return undefined;
}
