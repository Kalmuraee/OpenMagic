import { describe, expect, it } from "vitest";
import { buildOpenAICompatibleRequest } from "../src/llm/openai.js";
import { classifyProviderResponse } from "../src/llm/provider-test.js";
import type { ChatMessage, LlmContext } from "../src/shared-types.js";

const messages: ChatMessage[] = [{ role: "user", content: "Fix the page" }];
const screenshotContext: LlmContext = { screenshot: "data:image/png;base64,abc" };

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

  it("keeps DeepSeek V4 Flash in non-thinking mode by default", () => {
    const body = buildOpenAICompatibleRequest("deepseek", "deepseek-v4-flash", messages, {});

    expect(body.max_tokens).toBe(4096);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("uses DeepSeek V4 Pro thinking defaults", () => {
    const body = buildOpenAICompatibleRequest("deepseek", "deepseek-v4-pro", messages, {});

    expect(body.reasoning_effort).toBe("high");
    expect(body.max_tokens).toBe(16384);
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
