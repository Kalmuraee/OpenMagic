import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearModelCache, fetchProviderModels, getToolbarRegistry } from "../src/llm/models.js";

describe("model registry", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "openmagic-model-cache-"));
    vi.stubEnv("OPENMAGIC_MODEL_CACHE_FILE", join(cacheDir, "model-cache.json"));
  });

  afterEach(() => {
    clearModelCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("exposes the server registry in toolbar-safe shape", () => {
    const registry = getToolbarRegistry();

    expect(registry.openai.models.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(registry.deepseek.models.some((model) => model.id === "deepseek-v4-flash")).toBe(true);
    expect(registry.deepseek.models.some((model) => model.id === "deepseek-v4-pro")).toBe(true);
    expect(registry.openai.keyUrl).toBe("https://platform.openai.com/api-keys");
  });

  it("falls back to static models when no API key is configured", async () => {
    const result = await fetchProviderModels("openai", "");

    expect(result.source).toBe("static");
    expect(result.error).toBe("API key not configured");
    expect(result.models.some((model) => model.id === "gpt-5.5")).toBe(true);
  });

  it("merges live OpenAI-compatible models with known static names", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "gpt-5.5" },
        { id: "provider-new-model" },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderModels("openai", "sk-test");

    expect(result.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer sk-test" },
    });
    expect(result.models).toContainEqual(expect.objectContaining({ id: "gpt-5.5", name: "GPT-5.5", provider: "openai", source: "live" }));
    expect(result.models).toContainEqual(expect.objectContaining({ id: "provider-new-model", name: "Provider New Model", provider: "openai", source: "live" }));
  });

  it("serves cached models until refresh is requested", async () => {
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: `provider-model-${++fetchCount}` }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchProviderModels("openai", "sk-test", { now: 1000 });
    const cached = await fetchProviderModels("openai", "sk-test", { now: 2000 });
    const refreshed = await fetchProviderModels("openai", "sk-test", { refresh: true, now: 3000 });

    expect(first.source).toBe("live");
    expect(cached.source).toBe("cache");
    expect(refreshed.source).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cached.models).toContainEqual(expect.objectContaining({ id: "provider-model-1", source: "cache" }));
    expect(refreshed.models).toContainEqual(expect.objectContaining({ id: "provider-model-2", source: "live" }));
  });

  it("persists live model cache to disk and reads it after memory cache is cleared", async () => {
    const cacheFile = join(cacheDir, "model-cache.json");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "persisted-model" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchProviderModels("openai", "sk-test", { now: 1000 });
    clearModelCache();
    const second = await fetchProviderModels("openai", "sk-test", { now: 2000 });

    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(cacheFile, "utf-8")).providers.openai.models).toContainEqual(expect.objectContaining({ id: "persisted-model" }));
  });

  it("maps DeepSeek V4 aliases in the static catalog", () => {
    const registry = getToolbarRegistry();

    expect(registry.deepseek.models).toContainEqual(expect.objectContaining({
      id: "deepseek-v4-flash",
      aliases: ["deepseek-chat", "deepseek-reasoner"],
    }));
    expect(registry.deepseek.models).toContainEqual(expect.objectContaining({
      id: "deepseek-chat",
      aliases: ["deepseek-v4-flash"],
    }));
  });

  it("filters Gemini live models to generateContent-capable entries", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { name: "models/gemini-live", displayName: "Gemini Live", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 128000 },
        { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderModels("google", "AIza-test");

    expect(result.source).toBe("live");
    expect(result.models).toContainEqual(expect.objectContaining({ id: "gemini-live", name: "Gemini Live" }));
    expect(result.models.some((model) => model.id === "text-embedding-004")).toBe(false);
  });
});
