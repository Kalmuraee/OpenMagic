import { spawn } from "node:child_process";
import { terminateChildProcessTree } from "./child-process.js";
import type { ChatMessage, LlmContext } from "../shared-types.js";
import { SYSTEM_PROMPT, NATIVE_EDIT_INSTRUCTION, buildUserMessage, buildContextParts } from "./prompts.js";

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

  // `codex exec` is the non-interactive subcommand (no TTY required)
  // --full-auto: auto-approve actions (alias for --sandbox workspace-write)
  // --json: structured JSONL output to stdout
  // --skip-git-repo-check: allow running outside git repos
  // - : read prompt from stdin
  await new Promise<void>((resolve) => {
  let processSettled = false;
  const settle = () => { if (!processSettled) { processSettled = true; resolve(); } };

  const proc = spawn(
    "codex",
    ["exec", "--full-auto", "--json", "--skip-git-repo-check", "-"],
    {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      cwd: context.projectRoot || process.cwd(),
    }
  );

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  let aborted = false;
  if (signal) {
    if (signal.aborted) { aborted = true; terminateChildProcessTree(proc); }
    else signal.addEventListener("abort", () => { aborted = true; terminateChildProcessTree(proc); }, { once: true });
  }

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
    settle();
  });

  proc.on("close", (code) => {
    if (aborted) { settle(); return; } // client cancelled — settle without callbacks
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
    settle();
  });
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
/**
 * Extract text from a Codex JSONL event.
 * item.text is the FULL accumulated text (not a delta), so we only
 * extract from item.completed to avoid duplicates.
 */
function extractCodexText(event: Record<string, unknown>): string | undefined {
  // Only emit on item.completed — text is full content, not a delta
  if (event.type === "item.completed") {
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      return item.text;
    }
  }

  return undefined;
}
