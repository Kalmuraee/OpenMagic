import { MODEL_REGISTRY } from "./registry.js";

export type ProviderTestStatus =
  | "success"
  | "invalid_key"
  | "model_unavailable"
  | "rate_limited"
  | "provider_error"
  | "network_error"
  | "unsupported_provider";

export interface ProviderTestResult {
  ok: boolean;
  status: ProviderTestStatus;
  message: string;
}

export async function testProviderModel(provider: string, model: string, apiKey: string): Promise<ProviderTestResult> {
  const providerConfig = MODEL_REGISTRY[provider];
  if (!providerConfig) {
    return { ok: false, status: "unsupported_provider", message: `Unsupported provider: ${provider}` };
  }
  if (!providerConfig.local && !apiKey) {
    return { ok: false, status: "invalid_key", message: "API key is not configured" };
  }

  try {
    let response: Response;
    if (provider === "anthropic") {
      response = await fetch(`${providerConfig.apiBase}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply ok." }],
        }),
      });
    } else if (provider === "google") {
      response = await fetch(`${providerConfig.apiBase}/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply ok." }] }] }),
      });
    } else {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider !== "ollama") headers.Authorization = `Bearer ${apiKey}`;
      response = await fetch(`${providerConfig.apiBase}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply ok." }],
          stream: false,
          max_tokens: 16,
        }),
      });
    }

    if (response.ok) {
      return { ok: true, status: "success", message: "Model test succeeded" };
    }
    return classifyProviderResponse(response.status, await response.text().catch(() => ""));
  } catch (error) {
    return {
      ok: false,
      status: "network_error",
      message: error instanceof Error ? error.message : "Network error",
    };
  }
}

export function classifyProviderResponse(status: number, body: string): ProviderTestResult {
  if (status === 401 || status === 403) {
    return { ok: false, status: "invalid_key", message: "Invalid API key or provider rejected authentication" };
  }
  if (status === 404) {
    return { ok: false, status: "model_unavailable", message: "Model is unavailable for this provider/account" };
  }
  if (status === 429) {
    return { ok: false, status: "rate_limited", message: "Rate limit or quota exceeded" };
  }
  if (status >= 500) {
    return { ok: false, status: "provider_error", message: `Provider error ${status}` };
  }
  return {
    ok: false,
    status: "provider_error",
    message: `Provider returned ${status}: ${body.slice(0, 160)}`,
  };
}
