import { describe, it, expect } from "vitest";
import { buildOpenAICompatibleRequest } from "../src/llm/openai.js";
import { buildAnthropicRequest } from "../src/llm/anthropic.js";
import { buildGoogleRequest } from "../src/llm/google.js";
import type { ChatMessage, LlmContext, ModelInfo } from "../src/shared-types.js";

const msgs: ChatMessage[] = [{ role: "user", content: "make it red" }];

const reasoningModel: ModelInfo = {
  id: "reasoner", name: "Reasoner", vision: true, context: 400000, maxOutput: 128000,
  thinking: { supported: true, paramName: "reasoning_effort", paramType: "level", defaultLevel: "medium" },
};
const plainModel: ModelInfo = {
  id: "plain", name: "Plain", vision: false, context: 32000, maxOutput: 32000,
};
const anthropicThinker: ModelInfo = {
  id: "claude-x", name: "Claude X", vision: true, context: 200000, maxOutput: 64000,
  thinking: { supported: true, paramName: "budget_tokens", paramType: "budget", defaultBudget: 8000, maxBudget: 32000 },
};
const geminiThinker: ModelInfo = {
  id: "gemini-x", name: "Gemini X", vision: true, context: 1000000, maxOutput: 65536,
  thinking: { supported: true, paramName: "thinking_level", paramType: "level", defaultLevel: "low" },
};

describe("buildOpenAICompatibleRequest", () => {
  it("raises max_tokens to the model's full maxOutput instead of 4096", () => {
    const body = buildOpenAICompatibleRequest("mistral", "plain", msgs, {}, plainModel);
    expect(body.max_tokens).toBe(32000);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("uses max_completion_tokens for gpt-5 models, at full maxOutput", () => {
    const body = buildOpenAICompatibleRequest("openai", "gpt-5.5", msgs, {}, reasoningModel);
    expect(body.max_completion_tokens).toBe(128000);
    expect(body.max_tokens).toBeUndefined();
  });

  it("applies the per-request reasoning level for thinking models", () => {
    const ctx: LlmContext = { reasoningLevel: "high" };
    const body = buildOpenAICompatibleRequest("openai", "gpt-5.5", msgs, ctx, reasoningModel);
    expect(body.reasoning_effort).toBe("high");
  });

  it("does not set reasoning_effort for non-thinking models", () => {
    const body = buildOpenAICompatibleRequest("mistral", "plain", msgs, { reasoningLevel: "high" }, plainModel);
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe("buildAnthropicRequest", () => {
  it("raises max_tokens to maxOutput and keeps the thinking budget below it", () => {
    const body = buildAnthropicRequest("claude-x", msgs, { thinkingBudget: 20000 }, anthropicThinker) as Record<string, any>;
    expect(body.max_tokens).toBe(64000);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 20000 });
    expect(body.thinking.budget_tokens).toBeLessThan(body.max_tokens);
  });

  it("omits thinking when the model does not support it", () => {
    const body = buildAnthropicRequest("plain", msgs, {}, plainModel) as Record<string, any>;
    expect(body.max_tokens).toBe(32000);
    expect(body.thinking).toBeUndefined();
  });

  it("marks the system prompt cacheable (prompt caching) — Phase 4", () => {
    const body = buildAnthropicRequest("plain", msgs, {}, plainModel) as Record<string, any>;
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(typeof body.system[0].text).toBe("string");
  });
});

describe("buildGoogleRequest", () => {
  it("raises maxOutputTokens to maxOutput instead of 8192", () => {
    const body = buildGoogleRequest("gemini-x", msgs, {}, geminiThinker) as Record<string, any>;
    expect(body.generationConfig.maxOutputTokens).toBe(65536);
  });

  it("applies the per-request thinking level", () => {
    const body = buildGoogleRequest("gemini-x", msgs, { reasoningLevel: "high" }, geminiThinker) as Record<string, any>;
    expect((body.generationConfig as any).thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
  });
});
