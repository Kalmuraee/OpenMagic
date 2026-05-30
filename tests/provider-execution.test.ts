import { describe, expect, it } from "vitest";
import { buildOpenAICompatibleRequest } from "../src/llm/openai.js";
import { classifyProviderResponse } from "../src/llm/provider-test.js";
import { MODEL_REGISTRY } from "../src/llm/registry.js";
import type { ChatMessage, LlmContext } from "../src/shared-types.js";

const messages: ChatMessage[] = [{ role: "user", content: "Fix the page" }];
const screenshotContext: LlmContext = { screenshot: "data:image/png;base64,abc" };

function maxOutputOf(provider: string, modelId: string): number {
  return MODEL_REGISTRY[provider].models.find((m) => m.id === modelId)!.maxOutput;
}

describe("provider request construction", () => {
  it("does not include image payloads for non-vision models", () => {
    const body = buildOpenAICompatibleRequest("deepseek", "deepseek-v4-flash", messages, screenshotContext);

    expect(JSON.stringify(body.messages)).not.toContain("image_url");
  });

  it("uses OpenAI completion token and reasoning fields for GPT-5 models", () => {
    const body = buildOpenAICompatibleRequest("openai", "gpt-5.5", messages, {});

    expect(body.max_completion_tokens).toBeDefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBe("medium");
  });

  it("keeps DeepSeek V4 Flash in non-thinking mode but lifts its output cap to maxOutput", () => {
    const body = buildOpenAICompatibleRequest("deepseek", "deepseek-v4-flash", messages, {});

    // H13: output budget raised from the old hardcoded 4096 to the model's real cap.
    expect(body.max_tokens).toBe(maxOutputOf("deepseek", "deepseek-v4-flash"));
    expect(body.max_tokens).toBeGreaterThan(4096);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("uses DeepSeek V4 Pro thinking defaults and the full output cap", () => {
    const body = buildOpenAICompatibleRequest("deepseek", "deepseek-v4-pro", messages, {});

    expect(body.reasoning_effort).toBe("high");
    // H13: was hardcoded to 16384; now the model's real maxOutput.
    expect(body.max_tokens).toBe(maxOutputOf("deepseek", "deepseek-v4-pro"));
    expect(body.max_tokens).toBeGreaterThan(16384);
  });
});

describe("provider test error classification", () => {
  it("classifies actionable provider failures", () => {
    expect(classifyProviderResponse(401, "").status).toBe("invalid_key");
    expect(classifyProviderResponse(404, "").status).toBe("model_unavailable");
    expect(classifyProviderResponse(429, "").status).toBe("rate_limited");
    expect(classifyProviderResponse(500, "").status).toBe("provider_error");
  });
});
