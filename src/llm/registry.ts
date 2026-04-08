import type { ProviderRegistry } from "../shared-types.js";

export const MODEL_REGISTRY: ProviderRegistry = {
  // ─── Claude Code (CLI) ────────────────────────────────────────
  "claude-code": {
    name: "Claude Code (CLI)",
    models: [
      {
        id: "claude-code",
        name: "Claude Code",
        vision: false,
        context: 200000,
        maxOutput: 64000,
      },
    ],
    apiBase: "",
    keyPrefix: "",
    keyPlaceholder: "not required",
    local: true,
  },

  // ─── Codex CLI ────────────────────────────────────────────────
  "codex-cli": {
    name: "Codex CLI",
    models: [
      {
        id: "codex-cli",
        name: "Codex CLI",
        vision: false,
        context: 192000,
        maxOutput: 100000,
      },
    ],
    apiBase: "",
    keyPrefix: "",
    keyPlaceholder: "not required",
    local: true,
  },

  // ─── Gemini CLI ───────────────────────────────────────────────
  "gemini-cli": {
    name: "Gemini CLI",
    models: [
      {
        id: "gemini-cli",
        name: "Gemini CLI",
        vision: false,
        context: 1048576,
        maxOutput: 65536,
      },
    ],
    apiBase: "",
    keyPrefix: "",
    keyPlaceholder: "not required",
    local: true,
  },

  // ─── OpenAI ───────────────────────────────────────────────────
  openai: {
    name: "OpenAI",
    models: [
      // GPT-5.4 family (March 2026 — latest flagship)
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        vision: true,
        context: 1050000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["none", "low", "medium", "high", "xhigh"],
          defaultLevel: "medium",
        },
      },
      {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        vision: true,
        context: 1050000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["none", "low", "medium", "high", "xhigh"],
          defaultLevel: "high",
        },
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        vision: true,
        context: 400000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["none", "low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        vision: true,
        context: 400000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["none", "low", "medium", "high"],
          defaultLevel: "low",
        },
      },
      // GPT-5.2 family (reasoning-focused)
      {
        id: "gpt-5.2",
        name: "GPT-5.2 Thinking",
        vision: true,
        context: 272000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["none", "low", "medium", "high", "xhigh"],
          defaultLevel: "high",
        },
      },
      {
        id: "gpt-5.2-pro",
        name: "GPT-5.2 Pro",
        vision: true,
        context: 272000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["none", "low", "medium", "high", "xhigh"],
          defaultLevel: "high",
        },
      },
      // o-series reasoning models
      {
        id: "o3",
        name: "o3 (Reasoning)",
        vision: true,
        context: 200000,
        maxOutput: 100000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      {
        id: "o4-mini",
        name: "o4-mini (Reasoning)",
        vision: true,
        context: 200000,
        maxOutput: 100000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      // GPT-4.1 family
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        vision: true,
        context: 1047576,
        maxOutput: 32768,
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        vision: true,
        context: 1047576,
        maxOutput: 32768,
      },
      {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        vision: true,
        context: 1047576,
        maxOutput: 32768,
      },
      // Codex
      {
        id: "codex-mini-latest",
        name: "Codex Mini",
        vision: false,
        context: 192000,
        maxOutput: 100000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "high",
        },
      },
    ],
    apiBase: "https://api.openai.com/v1",
    keyPrefix: "sk-",
    keyPlaceholder: "sk-...",
  },

  // ─── Anthropic ────────────────────────────────────────────────
  anthropic: {
    name: "Anthropic",
    models: [
      // Claude 4.6 (latest — Feb 2026)
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        vision: true,
        context: 1000000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 10000,
          maxBudget: 128000,
        },
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        vision: true,
        context: 1000000,
        maxOutput: 64000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 8000,
          maxBudget: 64000,
        },
      },
      // Claude 4.5
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        vision: true,
        context: 200000,
        maxOutput: 64000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 5000,
          maxBudget: 64000,
        },
      },
      {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        vision: true,
        context: 1000000,
        maxOutput: 64000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 8000,
          maxBudget: 64000,
        },
      },
      {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        vision: true,
        context: 200000,
        maxOutput: 64000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 10000,
          maxBudget: 64000,
        },
      },
      // Claude 4.0
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        vision: true,
        context: 200000,
        maxOutput: 64000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 8000,
          maxBudget: 64000,
        },
      },
      {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        vision: true,
        context: 200000,
        maxOutput: 32000,
        thinking: {
          supported: true,
          paramName: "budget_tokens",
          paramType: "budget",
          defaultBudget: 10000,
          maxBudget: 32000,
        },
      },
    ],
    apiBase: "https://api.anthropic.com/v1",
    keyPrefix: "sk-ant-",
    keyPlaceholder: "sk-ant-...",
  },

  // ─── Google Gemini ────────────────────────────────────────────
  google: {
    name: "Google Gemini",
    models: [
      // Gemini 3.1 (latest — Feb-Mar 2026)
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        vision: true,
        context: 1048576,
        maxOutput: 65536,
        thinking: {
          supported: true,
          paramName: "thinking_level",
          paramType: "level",
          levels: ["none", "low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      // Gemini 3.0
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash",
        vision: true,
        context: 1048576,
        maxOutput: 65536,
        thinking: {
          supported: true,
          paramName: "thinking_level",
          paramType: "level",
          levels: ["none", "low", "medium", "high"],
          defaultLevel: "low",
        },
      },
      {
        id: "gemini-3.1-flash-lite-preview",
        name: "Gemini 3.1 Flash Lite",
        vision: true,
        context: 1048576,
        maxOutput: 65536,
      },
      // Gemini 2.5
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        vision: true,
        context: 1048576,
        maxOutput: 65536,
        thinking: {
          supported: true,
          paramName: "thinking_level",
          paramType: "level",
          levels: ["none", "low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        vision: true,
        context: 1048576,
        maxOutput: 65536,
        thinking: {
          supported: true,
          paramName: "thinking_level",
          paramType: "level",
          levels: ["none", "low", "medium", "high"],
          defaultLevel: "low",
        },
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        vision: true,
        context: 1048576,
        maxOutput: 65536,
      },
    ],
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    keyPrefix: "AI",
    keyPlaceholder: "AIza...",
  },

  // ─── xAI (Grok) ──────────────────────────────────────────────
  xai: {
    name: "xAI (Grok)",
    models: [
      {
        id: "grok-4.20-0309-reasoning",
        name: "Grok 4.20 Reasoning",
        vision: true,
        context: 2000000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      {
        id: "grok-4.20-0309-non-reasoning",
        name: "Grok 4.20",
        vision: true,
        context: 2000000,
        maxOutput: 128000,
      },
      {
        id: "grok-4-1-fast-reasoning",
        name: "Grok 4.1 Fast Reasoning",
        vision: true,
        context: 2000000,
        maxOutput: 128000,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "low",
        },
      },
      {
        id: "grok-4-1-fast-non-reasoning",
        name: "Grok 4.1 Fast",
        vision: true,
        context: 2000000,
        maxOutput: 128000,
      },
    ],
    apiBase: "https://api.x.ai/v1",
    keyPrefix: "xai-",
    keyPlaceholder: "xai-...",
  },

  // ─── DeepSeek ─────────────────────────────────────────────────
  deepseek: {
    name: "DeepSeek",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek V3.2",
        vision: false,
        context: 128000,
        maxOutput: 8192,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek R1",
        vision: false,
        context: 128000,
        maxOutput: 8192,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
    ],
    apiBase: "https://api.deepseek.com/v1",
    keyPrefix: "sk-",
    keyPlaceholder: "sk-...",
  },

  // ─── Mistral ──────────────────────────────────────────────────
  mistral: {
    name: "Mistral",
    models: [
      {
        id: "mistral-large-3-25-12",
        name: "Mistral Large 3",
        vision: true,
        context: 131072,
        maxOutput: 32768,
      },
      {
        id: "mistral-small-4-0-26-03",
        name: "Mistral Small 4",
        vision: true,
        context: 131072,
        maxOutput: 32768,
      },
      {
        id: "mistral-small-3-2-25-06",
        name: "Mistral Small 3.2",
        vision: true,
        context: 131072,
        maxOutput: 32768,
      },
      {
        id: "codestral-2508",
        name: "Codestral",
        vision: false,
        context: 262144,
        maxOutput: 32768,
      },
      {
        id: "devstral-2-25-12",
        name: "Devstral 2",
        vision: false,
        context: 131072,
        maxOutput: 32768,
      },
      {
        id: "magistral-medium-1-2-25-09",
        name: "Magistral Medium (Reasoning)",
        vision: false,
        context: 131072,
        maxOutput: 32768,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      {
        id: "magistral-small-1-2-25-09",
        name: "Magistral Small (Reasoning)",
        vision: false,
        context: 131072,
        maxOutput: 32768,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
    ],
    apiBase: "https://api.mistral.ai/v1",
    keyPrefix: "",
    keyPlaceholder: "Enter API key...",
  },

  // ─── Groq ─────────────────────────────────────────────────────
  groq: {
    name: "Groq",
    models: [
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B",
        vision: true,
        context: 131072,
        maxOutput: 8192,
      },
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        vision: false,
        context: 131072,
        maxOutput: 32768,
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B Instant",
        vision: false,
        context: 131072,
        maxOutput: 8192,
      },
      {
        id: "qwen/qwen3-32b",
        name: "Qwen 3 32B",
        vision: false,
        context: 131072,
        maxOutput: 8192,
      },
    ],
    apiBase: "https://api.groq.com/openai/v1",
    keyPrefix: "gsk_",
    keyPlaceholder: "gsk_...",
  },

  // ─── MiniMax ───────────────────────────────────────────────────
  minimax: {
    name: "MiniMax",
    models: [
      { id: "MiniMax-M2.7", name: "MiniMax M2.7", vision: true, context: 1048576, maxOutput: 16384 },
      { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed", vision: true, context: 1048576, maxOutput: 16384 },
      { id: "MiniMax-M2.5", name: "MiniMax M2.5", vision: true, context: 1048576, maxOutput: 16384 },
      { id: "MiniMax-M2.5-highspeed", name: "MiniMax M2.5 Highspeed", vision: true, context: 1048576, maxOutput: 16384 },
    ],
    apiBase: "https://api.minimax.chat/v1",
    keyPrefix: "",
    keyPlaceholder: "Enter MiniMax API key...",
  },

  // ─── Moonshot / Kimi ──────────────────────────────────────────
  moonshot: {
    name: "Kimi (Moonshot)",
    models: [
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        vision: true,
        context: 262144,
        maxOutput: 16384,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "medium",
        },
      },
      {
        id: "kimi-k2-thinking",
        name: "Kimi K2 Thinking",
        vision: false,
        context: 262144,
        maxOutput: 16384,
        thinking: {
          supported: true,
          paramName: "reasoning_effort",
          paramType: "level",
          levels: ["low", "medium", "high"],
          defaultLevel: "high",
        },
      },
    ],
    apiBase: "https://api.moonshot.cn/v1",
    keyPrefix: "",
    keyPlaceholder: "Enter Moonshot API key...",
  },

  // ─── Alibaba Qwen (DashScope) ────────────────────────────────
  qwen: {
    name: "Qwen (Alibaba)",
    models: [
      { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", vision: true, context: 1010000, maxOutput: 16384 },
      { id: "qwen-plus", name: "Qwen Plus", vision: false, context: 131072, maxOutput: 16384 },
      { id: "qwen-max", name: "Qwen Max", vision: false, context: 131072, maxOutput: 16384 },
      { id: "qwen-turbo", name: "Qwen Turbo", vision: false, context: 131072, maxOutput: 8192 },
    ],
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyPrefix: "",
    keyPlaceholder: "Enter DashScope API key...",
  },

  // ─── Zhipu AI (GLM) ──────────────────────────────────────────
  zhipu: {
    name: "Zhipu AI (GLM)",
    models: [
      { id: "glm-5", name: "GLM-5", vision: true, context: 131072, maxOutput: 16384 },
      { id: "glm-4.7", name: "GLM-4.7", vision: true, context: 131072, maxOutput: 16384 },
      { id: "glm-4.6", name: "GLM-4.6", vision: true, context: 131072, maxOutput: 16384 },
      { id: "glm-4.5", name: "GLM-4.5", vision: true, context: 131072, maxOutput: 16384 },
    ],
    apiBase: "https://open.bigmodel.cn/api/paas/v4",
    keyPrefix: "",
    keyPlaceholder: "Enter Zhipu API key...",
  },

  // ─── ByteDance Doubao ─────────────────────────────────────────
  doubao: {
    name: "Doubao (ByteDance)",
    models: [
      { id: "doubao-seed-2-0-pro", name: "Doubao Seed 2.0 Pro", vision: false, context: 131072, maxOutput: 16384 },
      { id: "doubao-seed-2-0-lite", name: "Doubao Seed 2.0 Lite", vision: false, context: 131072, maxOutput: 8192 },
      { id: "doubao-seed-2-0-code", name: "Doubao Seed 2.0 Code", vision: false, context: 131072, maxOutput: 16384 },
    ],
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    keyPrefix: "",
    keyPlaceholder: "Enter Volcano Engine API key...",
  },

  // ─── Ollama (Local) ───────────────────────────────────────────
  ollama: {
    name: "Ollama (Local)",
    models: [],
    apiBase: "http://localhost:11434/v1",
    keyPrefix: "",
    keyPlaceholder: "not required",
    local: true,
  },

  // ─── OpenRouter (200+ models) ─────────────────────────────────
  openrouter: {
    name: "OpenRouter",
    models: [],
    apiBase: "https://openrouter.ai/api/v1",
    keyPrefix: "sk-or-",
    keyPlaceholder: "sk-or-...",
  },
};
