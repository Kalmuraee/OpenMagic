import { describe, expect, it } from "vitest";
import { getExecutionAdapter, isCliProvider } from "../src/llm/execution-adapters.js";

describe("execution adapter registry", () => {
  it("maps OpenAI-compatible providers to the shared adapter", () => {
    expect(getExecutionAdapter("openai")?.id).toBe("openai-compatible-chat-completions");
    expect(getExecutionAdapter("deepseek")?.id).toBe("openai-compatible-chat-completions");
    expect(getExecutionAdapter("openrouter")?.id).toBe("openai-compatible-chat-completions");
  });

  it("maps first-class provider adapters", () => {
    expect(getExecutionAdapter("anthropic")?.id).toBe("anthropic-messages");
    expect(getExecutionAdapter("google")?.id).toBe("google-generate-content");
  });

  it("maps local CLI providers", () => {
    expect(getExecutionAdapter("claude-code")?.id).toBe("claude-code-cli");
    expect(getExecutionAdapter("codex-cli")?.id).toBe("codex-cli");
    expect(getExecutionAdapter("gemini-cli")?.id).toBe("gemini-cli");
    expect(isCliProvider("codex-cli")).toBe(true);
    expect(isCliProvider("openai")).toBe(false);
  });

  it("rejects unknown providers", () => {
    expect(getExecutionAdapter("unknown")).toBeNull();
  });
});
