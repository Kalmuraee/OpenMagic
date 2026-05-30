import type { LlmContext, ModelInfo, ThinkingLevel } from "../shared-types.js";

// Used only when a model declares no maxOutput. Real models carry their true cap
// in the registry; this is just a floor so we never send the old hardcoded 4096.
export const DEFAULT_MAX_OUTPUT = 8192;

const VALID_LEVELS: ThinkingLevel[] = ["none", "low", "medium", "high", "xhigh"];

/** Narrow an untrusted string (e.g. saved config) to a valid ThinkingLevel. */
export function coerceThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return typeof value === "string" && (VALID_LEVELS as string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;
}

/** The model's real maximum output tokens (registry value), or a safe default. */
export function resolveMaxOutput(modelInfo?: ModelInfo): number {
  const m = modelInfo?.maxOutput;
  return typeof m === "number" && m > 0 ? m : DEFAULT_MAX_OUTPUT;
}

/**
 * The reasoning level to use for a "level"-type thinking provider: the per-request
 * value when valid, else the model default. Undefined when the model can't think.
 */
export function resolveReasoningLevel(
  context: LlmContext,
  modelInfo?: ModelInfo
): ThinkingLevel | undefined {
  if (!modelInfo?.thinking?.supported) return undefined;
  const requested = context.reasoningLevel;
  if (requested && VALID_LEVELS.includes(requested)) return requested;
  return modelInfo.thinking.defaultLevel;
}

/**
 * The thinking budget (token count) for a "budget"-type provider: per-request value
 * else model default, clamped to stay strictly below the model's max output so the
 * request's max_tokens can always exceed the reasoning budget. 0 = no thinking.
 */
export function resolveThinkingBudget(context: LlmContext, modelInfo?: ModelInfo): number {
  const thinking = modelInfo?.thinking;
  if (!thinking?.supported || thinking.paramType !== "budget") return 0;

  const requested = context.thinkingBudget;
  let budget =
    typeof requested === "number" && requested > 0 ? requested : thinking.defaultBudget || 0;
  if (budget <= 0) return 0;

  const ceiling = thinking.maxBudget ?? resolveMaxOutput(modelInfo);
  // leave headroom below max_tokens for the actual answer
  const clamp = Math.max(1024, ceiling - 1024);
  return Math.min(budget, clamp);
}

/** Map our ThinkingLevel onto OpenAI's reasoning_effort scale. */
export function mapOpenAiEffort(level: ThinkingLevel): string | undefined {
  if (level === "none") return undefined;
  if (level === "xhigh") return "high"; // OpenAI's ceiling
  return level; // low | medium | high
}

/** Map our ThinkingLevel onto Google's thinking_level enum. */
export function mapGoogleThinkingLevel(level: ThinkingLevel): string | undefined {
  if (level === "none") return undefined;
  if (level === "xhigh") return "HIGH";
  return level.toUpperCase();
}
