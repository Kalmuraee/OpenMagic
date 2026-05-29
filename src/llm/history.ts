import type { ChatMessage, ContentPart } from "../shared-types.js";

// UI-control markers the toolbar stores in `state.messages` purely to drive its
// own rendering / state machine. They must never reach the model — they are
// base64 blobs, not conversation. See src/toolbar/index.ts (renderChat cases).
export const SENTINEL_PREFIXES = [
  "__DIFF__",
  "__APPLIED__",
  "__REDO__",
  "__PLAN_CONFIRM__",
  "__RETRY__",
] as const;

export function isSentinel(content: string): boolean {
  return SENTINEL_PREFIXES.some((p) => content.startsWith(p));
}

const FEEDBACK_HEADER =
  "[Tool feedback from earlier in this session — take these into account before responding]";

function foldFeedbackIntoContent(
  content: ChatMessage["content"],
  note: string
): ChatMessage["content"] {
  if (typeof content === "string") {
    return content ? `${content}\n\n${note}` : note;
  }
  // Vision message: append the feedback as an extra text part, keep images.
  const parts: ContentPart[] = [...content, { type: "text", text: note }];
  return parts;
}

/**
 * Prepares the toolbar's `state.messages` for an LLM request.
 *
 * The toolbar keeps UI sentinels (`__DIFF__`, `__APPLIED__`, …) and load-bearing
 * feedback (rejections, "search did not match", read failures, verify errors) as
 * `role:"system"` messages. Every API adapter drops `role:"system"`, and the CLI
 * adapters only read the last user turn — so that feedback never reaches the model
 * and the loop cannot self-correct.
 *
 * This:
 *   1. removes UI-control sentinel messages entirely (they are not conversation),
 *   2. collects the remaining system feedback and folds it into the **last user
 *      message** (where it survives the system-drop AND reaches CLI agents),
 *   3. leaves user/assistant turns and their order otherwise intact.
 *
 * Pure — never mutates the input.
 */
export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const feedback: string[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") {
        if (isSentinel(m.content)) continue; // UI-control marker → drop
        const trimmed = m.content.trim();
        if (trimmed) feedback.push(trimmed); // genuine feedback → fold later
      }
      continue; // adapters drop standalone system messages anyway
    }
    // Clone so we never mutate caller-owned message objects.
    out.push({ role: m.role, content: m.content });
  }

  if (feedback.length === 0) return out;

  const note = `${FEEDBACK_HEADER}\n${feedback.map((f) => `- ${f}`).join("\n")}`;

  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = { role: "user", content: foldFeedbackIntoContent(out[i].content, note) };
      return out;
    }
  }

  // No user turn to fold into — deliver the feedback as its own user message
  // rather than losing it.
  out.push({ role: "user", content: note });
  return out;
}
