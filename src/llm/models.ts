import type { ModelInfo, ProviderInfo } from "../shared-types.js";
import { MODEL_REGISTRY } from "./registry.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config.js";

export type ModelSource = "live" | "static" | "cache";

export interface ModelCapabilities {
  chat: boolean;
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  audio: boolean;
  embeddings: boolean;
}

export interface ModelLimits {
  contextTokens?: number;
  maxOutputTokens?: number;
}

export interface ModelPricing {
  inputPerMTok?: number;
  outputPerMTok?: number;
  cachedInputPerMTok?: number;
}

export interface ModelCatalogEntry {
  id: string;
  name: string;
  provider: string;
  source: ModelSource;
  aliases?: string[];
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  pricing?: ModelPricing;
  deprecated?: boolean;
  deprecationDate?: string;
  fetchedAt: number;
}

export type ToolbarModelInfo = ModelCatalogEntry;

export interface ToolbarProviderInfo {
  name: string;
  models: ToolbarModelInfo[];
  keyPlaceholder: string;
  local?: boolean;
  keyUrl?: string;
}

export interface ProviderModelsResult {
  provider: string;
  models: ToolbarModelInfo[];
  source: ModelSource;
  error?: string;
}

export interface FetchProviderModelsOptions {
  refresh?: boolean;
  now?: number;
}

interface CacheEntry {
  fetchedAt: number;
  models: ModelCatalogEntry[];
}

const CLOUD_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const LOCAL_CACHE_TTL_MS = 60 * 1000;
const modelCache = new Map<string, CacheEntry>();
const MODEL_CACHE_VERSION = 1;

const OPENAI_COMPATIBLE_MODEL_PROVIDERS = new Set([
  "openai",
  "deepseek",
  "groq",
  "mistral",
  "xai",
  "ollama",
  "openrouter",
  "minimax",
  "moonshot",
  "qwen",
  "zhipu",
  "doubao",
]);

const PROVIDER_KEY_URLS: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/apikey",
  xai: "https://console.x.ai/team/default/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  mistral: "https://console.mistral.ai/api-keys",
  groq: "https://console.groq.com/keys",
  minimax: "https://platform.minimax.chat/user-center/basic-information/interface-key",
  moonshot: "https://platform.moonshot.cn/console/api-keys",
  qwen: "https://dashscope.console.aliyun.com/apiKey",
  zhipu: "https://open.bigmodel.cn/usercenter/apikeys",
  doubao: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
  openrouter: "https://openrouter.ai/settings/keys",
};

export function clearModelCache(): void {
  modelCache.clear();
}

export function getToolbarRegistry(now = Date.now()): Record<string, ToolbarProviderInfo> {
  return Object.fromEntries(
    Object.entries(MODEL_REGISTRY).map(([id, provider]) => [id, toToolbarProvider(id, provider, now)])
  );
}

export async function fetchProviderModels(
  provider: string,
  apiKey: string,
  options: FetchProviderModelsOptions = {}
): Promise<ProviderModelsResult> {
  const providerInfo = MODEL_REGISTRY[provider];
  const now = options.now || Date.now();
  if (!providerInfo) {
    return { provider, models: [], source: "static", error: `Unknown provider: ${provider}` };
  }

  const staticModels = providerInfo.models.map((model) => toCatalogModel(provider, model, "static", now));
  const cached = getCachedModels(provider, providerInfo, now);
  if (cached && !options.refresh) {
    return { provider, models: cached, source: "cache" };
  }

  if (!providerInfo.local && !apiKey && provider !== "openrouter") {
    return { provider, models: cached || staticModels, source: cached ? "cache" : "static", error: "API key not configured" };
  }

  try {
    let liveModels: ModelCatalogEntry[] | null = null;
    if (provider === "openrouter") {
      liveModels = await fetchOpenRouterModels(provider, providerInfo, apiKey, now);
    } else if (provider === "ollama") {
      liveModels = await fetchOllamaModels(providerInfo, now);
    } else if (OPENAI_COMPATIBLE_MODEL_PROVIDERS.has(provider)) {
      liveModels = await fetchOpenAICompatibleModels(provider, providerInfo, apiKey, now);
    } else if (provider === "google") {
      liveModels = await fetchGoogleModels(providerInfo, apiKey, now);
    } else if (provider === "anthropic") {
      liveModels = await fetchAnthropicModels(providerInfo, apiKey, now);
    }

    if (!liveModels) {
      return { provider, models: cached || staticModels, source: cached ? "cache" : "static" };
    }

    const merged = mergeModels(staticModels, liveModels, now);
    modelCache.set(provider, { fetchedAt: now, models: merged });
    persistModelCache(provider, { fetchedAt: now, models: merged });
    return { provider, models: merged, source: "live" };
  } catch (error) {
    return {
      provider,
      models: cached || staticModels,
      source: cached ? "cache" : "static",
      error: error instanceof Error ? error.message : "Model fetch failed",
    };
  }
}

function toToolbarProvider(id: string, provider: ProviderInfo, now: number): ToolbarProviderInfo {
  return {
    name: provider.name,
    models: provider.models.map((model) => toCatalogModel(id, model, "static", now)),
    keyPlaceholder: provider.keyPlaceholder,
    local: provider.local,
    keyUrl: provider.keyUrl || PROVIDER_KEY_URLS[id],
  };
}

function toCatalogModel(provider: string, model: ModelInfo, source: ModelSource, fetchedAt: number): ModelCatalogEntry {
  const aliases = provider === "deepseek" ? getDeepSeekAliases(model.id) : undefined;
  return {
    id: model.id,
    name: model.name,
    provider,
    source,
    aliases,
    capabilities: {
      chat: true,
      vision: model.vision,
      tools: provider !== "ollama",
      structuredOutput: provider !== "ollama",
      reasoning: !!model.thinking?.supported,
      audio: false,
      embeddings: false,
    },
    limits: {
      contextTokens: model.context,
      maxOutputTokens: model.maxOutput,
    },
    fetchedAt,
  };
}

async function fetchOpenAICompatibleModels(
  provider: string,
  providerInfo: ProviderInfo,
  apiKey: string,
  now: number
): Promise<ModelCatalogEntry[]> {
  const headers: Record<string, string> = {};
  if (provider !== "ollama") {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${providerInfo.apiBase}/models`, { headers });
  if (!response.ok) {
    throw new Error(`${providerInfo.name} model fetch failed (${response.status})`);
  }

  const body = await response.json() as { data?: Array<{ id?: string; name?: string }> };
  return (body.data || [])
    .map((model) => normalizeLiveModel(provider, model.id || model.name || "", now))
    .filter((model): model is ModelCatalogEntry => !!model);
}

async function fetchOpenRouterModels(
  provider: string,
  providerInfo: ProviderInfo,
  apiKey: string,
  now: number
): Promise<ModelCatalogEntry[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(`${providerInfo.apiBase}/models`, { headers });
  if (!response.ok) {
    throw new Error(`${providerInfo.name} model fetch failed (${response.status})`);
  }

  const body = await response.json() as {
    data?: Array<{
      id?: string;
      name?: string;
      context_length?: number;
      architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
      supported_parameters?: string[];
      top_provider?: { max_completion_tokens?: number };
      expiration_date?: string | null;
    }>;
  };

  return (body.data || [])
    .map((model): ModelCatalogEntry | null => {
      if (!model.id) return null;
      const inputModalities = model.architecture?.input_modalities || [];
      const supported = model.supported_parameters || [];
      return {
        id: model.id,
        name: model.name || formatModelName(model.id),
        provider,
        source: "live" as const,
        capabilities: {
          chat: true,
          vision: inputModalities.includes("image"),
          tools: supported.includes("tools"),
          structuredOutput: supported.includes("structured_outputs") || supported.includes("response_format"),
          reasoning: supported.includes("reasoning") || supported.includes("include_reasoning"),
          audio: inputModalities.includes("audio"),
          embeddings: model.architecture?.output_modalities?.includes("embeddings") || false,
        },
        limits: {
          contextTokens: model.context_length,
          maxOutputTokens: model.top_provider?.max_completion_tokens,
        },
        pricing: {
          inputPerMTok: pricePerMTok(model.pricing?.prompt),
          outputPerMTok: pricePerMTok(model.pricing?.completion),
          cachedInputPerMTok: pricePerMTok(model.pricing?.input_cache_read),
        },
        deprecated: !!model.expiration_date,
        deprecationDate: model.expiration_date || undefined,
        fetchedAt: now,
      };
    })
    .filter((model): model is ModelCatalogEntry => !!model);
}

async function fetchOllamaModels(providerInfo: ProviderInfo, now: number): Promise<ModelCatalogEntry[]> {
  try {
    return await fetchOpenAICompatibleModels("ollama", providerInfo, "", now);
  } catch {
    const baseUrl = providerInfo.apiBase.replace(/\/v1$/, "");
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`${providerInfo.name} model fetch failed (${response.status})`);
    }
    const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    return (body.models || [])
      .map((model) => normalizeLiveModel("ollama", model.model || model.name || "", now))
      .filter((model): model is ModelCatalogEntry => !!model);
  }
}

async function fetchGoogleModels(providerInfo: ProviderInfo, apiKey: string, now: number): Promise<ModelCatalogEntry[]> {
  let nextPageToken = "";
  const results: ModelCatalogEntry[] = [];

  do {
    const url = new URL(`${providerInfo.apiBase}/models`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "1000");
    if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`${providerInfo.name} model fetch failed (${response.status})`);
    }

    const body = await response.json() as {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number; outputTokenLimit?: number }>;
      nextPageToken?: string;
    };

    for (const model of body.models || []) {
      if (!model.supportedGenerationMethods?.includes("generateContent")) continue;
      const id = (model.name || "").replace(/^models\//, "");
      if (!id) continue;
      results.push({
        id,
        name: model.displayName || formatModelName(id),
        provider: "google",
        source: "live",
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          structuredOutput: true,
          reasoning: /thinking|pro|flash/i.test(id),
          audio: false,
          embeddings: false,
        },
        limits: {
          contextTokens: model.inputTokenLimit,
          maxOutputTokens: model.outputTokenLimit,
        },
        fetchedAt: now,
      });
    }

    nextPageToken = body.nextPageToken || "";
  } while (nextPageToken);

  return results;
}

async function fetchAnthropicModels(providerInfo: ProviderInfo, apiKey: string, now: number): Promise<ModelCatalogEntry[]> {
  let afterId = "";
  const results: ModelCatalogEntry[] = [];

  do {
    const url = new URL(`${providerInfo.apiBase}/models`);
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);

    const response = await fetch(url.toString(), {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`${providerInfo.name} model fetch failed (${response.status})`);
    }

    const body = await response.json() as {
      data?: Array<{ id?: string; display_name?: string }>;
      has_more?: boolean;
      last_id?: string | null;
    };

    for (const model of body.data || []) {
      if (!model.id) continue;
      results.push({
        id: model.id,
        name: model.display_name || formatModelName(model.id),
        provider: "anthropic",
        source: "live",
        capabilities: {
          chat: true,
          vision: true,
          tools: true,
          structuredOutput: true,
          reasoning: /sonnet|opus/i.test(model.id),
          audio: false,
          embeddings: false,
        },
        limits: {},
        fetchedAt: now,
      });
    }

    afterId = body.has_more && body.last_id ? body.last_id : "";
  } while (afterId);

  return results;
}

function normalizeLiveModel(provider: string, id: string, fetchedAt: number): ModelCatalogEntry | null {
  if (!id) return null;
  return {
    id,
    name: formatModelName(id),
    provider,
    source: "live",
    aliases: provider === "deepseek" ? getDeepSeekAliases(id) : undefined,
    capabilities: {
      chat: true,
      vision: false,
      tools: provider !== "ollama",
      structuredOutput: provider !== "ollama",
      reasoning: /reason|thinking|o[0-9]|gpt-5|magistral|deepseek-v4-pro/i.test(id),
      audio: /audio|realtime/i.test(id),
      embeddings: /embed/i.test(id),
    },
    limits: {},
    fetchedAt,
  };
}

function mergeModels(staticModels: ModelCatalogEntry[], liveModels: ModelCatalogEntry[], now: number): ModelCatalogEntry[] {
  const byId = new Map<string, ModelCatalogEntry>();
  for (const model of staticModels) byId.set(model.id, model);
  for (const model of liveModels) {
    const staticModel = byId.get(model.id);
    byId.set(model.id, {
      ...model,
      name: staticModel?.name || model.name,
      aliases: staticModel?.aliases || model.aliases,
      capabilities: {
        ...model.capabilities,
        vision: staticModel?.capabilities.vision || model.capabilities.vision,
        reasoning: staticModel?.capabilities.reasoning || model.capabilities.reasoning,
      },
      limits: {
        contextTokens: model.limits.contextTokens || staticModel?.limits.contextTokens,
        maxOutputTokens: model.limits.maxOutputTokens || staticModel?.limits.maxOutputTokens,
      },
      fetchedAt: now,
    });
  }
  return [...byId.values()];
}

function getCachedModels(provider: string, providerInfo: ProviderInfo, now: number): ModelCatalogEntry[] | null {
  const cached = modelCache.get(provider) || readPersistedModelCache(provider);
  if (!cached) return null;
  const ttl = providerInfo.local ? LOCAL_CACHE_TTL_MS : CLOUD_CACHE_TTL_MS;
  if (now - cached.fetchedAt > ttl) return null;
  return cached.models.map((model) => ({ ...model, source: "cache" as const }));
}

function getModelCachePath(): string {
  return process.env.OPENMAGIC_MODEL_CACHE_FILE || join(getConfigDir(), "model-cache.json");
}

function readPersistedModelCache(provider: string): CacheEntry | null {
  try {
    const file = getModelCachePath();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      version?: number;
      providers?: Record<string, CacheEntry>;
    };
    if (parsed.version !== MODEL_CACHE_VERSION) return null;
    const entry = parsed.providers?.[provider];
    if (!entry?.models?.length) return null;
    modelCache.set(provider, entry);
    return entry;
  } catch {
    return null;
  }
}

function persistModelCache(provider: string, entry: CacheEntry): void {
  try {
    const file = getModelCachePath();
    let providers: Record<string, CacheEntry> = {};
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as { providers?: Record<string, CacheEntry> };
      providers = parsed.providers || {};
    }
    providers[provider] = entry;
    writeFileSync(file, JSON.stringify({ version: MODEL_CACHE_VERSION, providers }, null, 2), { encoding: "utf-8", mode: 0o600 });
  } catch {
    // Cache persistence is best-effort; model fetch results still return to the caller.
  }
}

function getDeepSeekAliases(id: string): string[] | undefined {
  if (id === "deepseek-v4-flash") return ["deepseek-chat", "deepseek-reasoner"];
  if (id === "deepseek-chat") return ["deepseek-v4-flash"];
  if (id === "deepseek-reasoner") return ["deepseek-v4-flash"];
  return undefined;
}

function pricePerMTok(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed * 1_000_000;
}

function formatModelName(id: string): string {
  return id
    .replace(/^models\//, "")
    .split(/[-_/.:]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^(gpt|glm|tts|r1|v[0-9]|m[0-9]|k2|o[0-9])$/i.test(part)) return part.toUpperCase();
      if (/^[0-9]+[a-z]?$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
