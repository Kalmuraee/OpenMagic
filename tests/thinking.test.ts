import { describe, it, expect } from "vitest";
import {
  resolveMaxOutput,
  resolveReasoningLevel,
  resolveThinkingBudget,
  mapOpenAiEffort,
  coerceThinkingLevel,
} from "../src/llm/thinking.js";
import type { ModelInfo, LlmContext } from "../src/shared-types.js";

const levelModel: ModelInfo = {
  id: "m-level",
  name: "Level model",
  vision: false,
  context: 200000,
  maxOutput: 128000,
  thinking: { supported: true, paramName: "reasoning_effort", paramType: "level", defaultLevel: "medium" },
};

const budgetModel: ModelInfo = {
  id: "m-budget",
  name: "Budget model",
  vision: false,
  context: 200000,
  maxOutput: 64000,
  thinking: { supported: true, paramName: "budget_tokens", paramType: "budget", defaultBudget: 8000, maxBudget: 32000 },
};

const plainModel: ModelInfo = {
  id: "m-plain",
  name: "Plain model",
  vision: false,
  context: 8000,
  maxOutput: 4096,
};

describe("resolveMaxOutput", () => {
  it("returns the model's maxOutput when it is a positive number", () => {
    expect(resolveMaxOutput(levelModel)).toBe(128000);
    expect(resolveMaxOutput(plainModel)).toBe(4096);
  });
  it("falls back to a default when maxOutput is missing or zero", () => {
    expect(resolveMaxOutput(undefined)).toBe(8192);
    expect(resolveMaxOutput({ ...plainModel, maxOutput: 0 })).toBe(8192);
  });
});

describe("resolveReasoningLevel", () => {
  it("uses the per-request level when valid and thinking is supported", () => {
    const ctx: LlmContext = { reasoningLevel: "high" };
    expect(resolveReasoningLevel(ctx, levelModel)).toBe("high");
  });
  it("falls back to the model default when no per-request level is given", () => {
    expect(resolveReasoningLevel({}, levelModel)).toBe("medium");
  });
  it("returns undefined when the model does not support thinking", () => {
    expect(resolveReasoningLevel({ reasoningLevel: "high" }, plainModel)).toBeUndefined();
  });
});

describe("resolveThinkingBudget", () => {
  it("uses the per-request budget when supported", () => {
    expect(resolveThinkingBudget({ thinkingBudget: 12000 }, budgetModel)).toBe(12000);
  });
  it("falls back to the model default budget", () => {
    expect(resolveThinkingBudget({}, budgetModel)).toBe(8000);
  });
  it("clamps the budget to stay below max output so max_tokens can exceed it", () => {
    // request more than maxBudget/maxOutput allows
    const b = resolveThinkingBudget({ thinkingBudget: 999999 }, budgetModel);
    expect(b).toBeLessThan(resolveMaxOutput(budgetModel));
    expect(b).toBeGreaterThan(0);
  });
  it("returns 0 for level-type or non-thinking models", () => {
    expect(resolveThinkingBudget({ thinkingBudget: 5000 }, levelModel)).toBe(0);
    expect(resolveThinkingBudget({ thinkingBudget: 5000 }, plainModel)).toBe(0);
  });
});

describe("mapOpenAiEffort", () => {
  it("passes through low/medium/high", () => {
    expect(mapOpenAiEffort("low")).toBe("low");
    expect(mapOpenAiEffort("medium")).toBe("medium");
    expect(mapOpenAiEffort("high")).toBe("high");
  });
  it("maps xhigh to high (OpenAI's ceiling) and none to undefined", () => {
    expect(mapOpenAiEffort("xhigh")).toBe("high");
    expect(mapOpenAiEffort("none")).toBeUndefined();
  });
});

describe("coerceThinkingLevel", () => {
  it("accepts valid levels", () => {
    expect(coerceThinkingLevel("high")).toBe("high");
    expect(coerceThinkingLevel("none")).toBe("none");
  });
  it("rejects junk and non-strings", () => {
    expect(coerceThinkingLevel("ultra")).toBeUndefined();
    expect(coerceThinkingLevel(undefined)).toBeUndefined();
    expect(coerceThinkingLevel(5)).toBeUndefined();
  });
});
