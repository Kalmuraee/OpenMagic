import { describe, it, expect } from "vitest";
import { sanitizeHistory, isSentinel, SENTINEL_PREFIXES } from "../src/llm/history.js";
import type { ChatMessage } from "../src/shared-types.js";

describe("isSentinel", () => {
  it("flags every known UI-control sentinel prefix", () => {
    for (const prefix of SENTINEL_PREFIXES) {
      expect(isSentinel(`${prefix}payload-here`)).toBe(true);
    }
  });

  it("does not flag ordinary feedback text", () => {
    expect(isSentinel('Rejected change to a.tsx: "old" → "new"')).toBe(false);
    expect(isSentinel("File not found: src/App.tsx")).toBe(false);
  });
});

describe("sanitizeHistory", () => {
  it("drops UI-control sentinel system messages entirely", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "make it blue" },
      { role: "assistant", content: "Done." },
      { role: "system", content: "__DIFF__eyJmb28iOiJiYXIifQ==" },
      { role: "system", content: "__APPLIED__abc123" },
    ];
    const result = sanitizeHistory(messages);
    expect(result.some((m) => typeof m.content === "string" && m.content.includes("__DIFF__"))).toBe(false);
    expect(result.some((m) => typeof m.content === "string" && m.content.includes("__APPLIED__"))).toBe(false);
    // user + assistant survive
    expect(result.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("folds plain system feedback into the last user message so adapters cannot drop it", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "make the button bigger" },
      { role: "assistant", content: "I changed padding." },
      { role: "system", content: 'Rejected change to Button.tsx: "p-2" → "p-8"' },
      { role: "user", content: "try again, only increase font size" },
    ];
    const result = sanitizeHistory(messages);
    // No standalone system message remains
    expect(result.every((m) => m.role !== "system")).toBe(true);
    const lastUser = [...result].reverse().find((m) => m.role === "user")!;
    expect(typeof lastUser.content).toBe("string");
    expect(lastUser.content as string).toContain("try again, only increase font size");
    expect(lastUser.content as string).toContain("Rejected change to Button.tsx");
  });

  it("folds multiple feedback notes as a list and preserves the original prompt text", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "fix the layout" },
      { role: "system", content: "Could not read src/Missing.tsx" },
      { role: "system", content: "Your search block did not match the file." },
    ];
    const result = sanitizeHistory(messages);
    const lastUser = [...result].reverse().find((m) => m.role === "user")!;
    const text = lastUser.content as string;
    expect(text).toContain("fix the layout");
    expect(text).toContain("Could not read src/Missing.tsx");
    expect(text).toContain("Your search block did not match the file.");
  });

  it("preserves user/assistant ordering and content untouched when there is no feedback", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    const result = sanitizeHistory(messages);
    expect(result).toEqual(messages);
  });

  it("appends feedback as a user message when there is no user turn to fold into", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Verification failed: TS2322 in App.tsx" },
    ];
    const result = sanitizeHistory(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content as string).toContain("Verification failed: TS2322 in App.tsx");
  });

  it("ignores empty/whitespace-only system messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "system", content: "   " },
    ];
    const result = sanitizeHistory(messages);
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("folds feedback into array-content (vision) user messages without dropping parts", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "match this design" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        ],
      },
      { role: "system", content: "Change rejected" },
    ];
    const result = sanitizeHistory(messages);
    const user = result.find((m) => m.role === "user")!;
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as Array<{ type: string; text?: string }>;
    // image part survives
    expect(parts.some((p) => p.type === "image_url")).toBe(true);
    // feedback appears in a text part
    expect(parts.some((p) => p.type === "text" && (p.text || "").includes("Change rejected"))).toBe(true);
  });

  it("does not mutate the input array or its messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "original" },
      { role: "system", content: "some feedback" },
    ];
    const snapshot = JSON.parse(JSON.stringify(messages));
    sanitizeHistory(messages);
    expect(messages).toEqual(snapshot);
  });
});
