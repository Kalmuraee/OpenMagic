import type { ChatMessage, CodeModification, LlmContext, ModelInfo } from "../shared-types.js";
import { buildContextParts, buildUserMessage } from "./prompts.js";
import { extractJsonFromResponse } from "./proxy.js";
import { resolveMaxOutput } from "./thinking.js";
import {
  buildAnthropicTools,
  buildGoogleTools,
  buildOpenAiTools,
  executeServerTool,
  extractAnthropicToolCalls,
  extractGoogleToolCalls,
  extractOpenAiToolCalls,
  type ToolCall,
  type ToolExecution,
} from "./tools.js";

const TOOL_SYSTEM_PROMPT = `You are OpenMagic, an AI coding assistant embedded in a developer's running web app.
You have tools to investigate the codebase: read_file, search_code, list_dir.
Use them to find the EXACT current source, then call propose_edits exactly once with your changes.
Each edit's "search" must be copied byte-for-byte from a file you read (matching whitespace/indentation).
For a question (not a change request), call propose_edits with an empty modifications array and your answer as the explanation.`;

export const DEFAULT_MAX_TOOL_STEPS = 12;

export interface ToolDriver {
  /** Send the current conversation + tool definitions, store the assistant turn, return parsed tool calls/text. */
  step(signal?: AbortSignal): Promise<{ toolCalls: ToolCall[]; text: string }>;
  /** Append tool outputs to the conversation in the provider's format. */
  submitToolResults(results: Array<{ call: ToolCall; output: string }>): void;
}

/**
 * Provider-neutral tool loop: investigate via tools, finalize via propose_edits.
 * Bounded by maxSteps; cancellable. Falls back to JSON-in-text parsing if the
 * model returns final prose without calling propose_edits.
 */
export async function runToolLoop(
  driver: ToolDriver,
  execute: (name: string, args: Record<string, unknown>) => ToolExecution,
  opts: { maxSteps?: number; signal?: AbortSignal; onProgress?: (s: string) => void }
): Promise<{ content: string; modifications: CodeModification[] }> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_TOOL_STEPS;

  for (let i = 0; i < maxSteps; i++) {
    if (opts.signal?.aborted) return { content: "", modifications: [] };

    const { toolCalls, text } = await driver.step(opts.signal);
    if (opts.signal?.aborted) return { content: "", modifications: [] };

    if (!toolCalls.length) {
      // No tool call — treat as final. Try to recover structured edits if the
      // model embedded JSON anyway, else return the prose.
      const json = extractJsonFromResponse(text);
      if (json) {
        try {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed.modifications)) {
            return { content: parsed.explanation || text, modifications: parsed.modifications };
          }
        } catch { /* fall through */ }
      }
      return { content: text, modifications: [] };
    }

    const results: Array<{ call: ToolCall; output: string }> = [];
    for (const call of toolCalls) {
      const exec = execute(call.name, call.arguments);
      if (exec.terminal) {
        return { content: exec.explanation || "", modifications: exec.modifications || [] };
      }
      results.push({ call, output: exec.content });
      opts.onProgress?.(`${call.name}(${Object.values(call.arguments)[0] ?? ""})`);
    }
    driver.submitToolResults(results);
  }

  return { content: "Reached the tool-call limit without finalizing an edit.", modifications: [] };
}

// ---------------------------------------------------------------------------
// Provider drivers (non-streaming tool calls — far simpler/safer to parse than
// assembling tool_use deltas, and the tool phase doesn't need token streaming).
// ---------------------------------------------------------------------------

function initialUserContent(messages: ChatMessage[], context: LlmContext): string {
  const lastUserIndex = messages.reduce((found, message, index) => message.role === "user" ? index : found, -1);
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const prompt = typeof lastUser?.content === "string" ? lastUser.content : "Help me with this element.";
  const history = messages.slice(0, Math.max(0, lastUserIndex))
    .filter((message) => typeof message.content === "string")
    .slice(-20)
    .map((message) => `${message.role.toUpperCase()}: ${message.content as string}`)
    .join("\n\n");
  const current = buildUserMessage(prompt, buildContextParts(context));
  return history ? `Previous conversation:\n${history}\n\nCurrent request:\n${current}` : current;
}

export class OpenAiToolDriver implements ToolDriver {
  private convo: any[];
  constructor(
    private apiBase: string,
    private model: string,
    private apiKey: string,
    private provider: string,
    private modelInfo: ModelInfo | undefined,
    messages: ChatMessage[],
    context: LlmContext
  ) {
    this.convo = [
      { role: "system", content: TOOL_SYSTEM_PROMPT },
      { role: "user", content: initialUserContent(messages, context) },
    ];
  }

  async step(signal?: AbortSignal): Promise<{ toolCalls: ToolCall[]; text: string }> {
    const usesCompletion = this.provider === "openai" &&
      (this.model.startsWith("gpt-5") || this.model.startsWith("o3") || this.model.startsWith("o4") || this.model.startsWith("codex"));
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.convo,
      tools: buildOpenAiTools(),
      tool_choice: "auto",
      stream: false,
    };
    body[usesCompletion ? "max_completion_tokens" : "max_tokens"] = resolveMaxOutput(this.modelInfo);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.provider !== "ollama") headers["Authorization"] = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body), signal,
    });
    if (!resp.ok) throw new Error(`${this.provider} tool call failed: ${resp.status} ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    const json = await resp.json();
    const message = json?.choices?.[0]?.message;
    if (message) this.convo.push(message);
    return extractOpenAiToolCalls(json);
  }

  submitToolResults(results: Array<{ call: ToolCall; output: string }>): void {
    for (const r of results) {
      this.convo.push({ role: "tool", tool_call_id: r.call.id, content: r.output });
    }
  }
}

export class AnthropicToolDriver implements ToolDriver {
  private messages: any[];
  constructor(
    private model: string,
    private apiKey: string,
    private modelInfo: ModelInfo | undefined,
    messages: ChatMessage[],
    context: LlmContext
  ) {
    this.messages = [{ role: "user", content: initialUserContent(messages, context) }];
  }

  async step(signal?: AbortSignal): Promise<{ toolCalls: ToolCall[]; text: string }> {
    const body = {
      model: this.model,
      max_tokens: resolveMaxOutput(this.modelInfo),
      // Cache the stable system prompt across tool-loop turns (Phase 4).
      system: [{ type: "text", text: TOOL_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: this.messages,
      tools: buildAnthropicTools(),
      stream: false,
    };
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal,
    });
    if (!resp.ok) throw new Error(`Anthropic tool call failed: ${resp.status} ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    const json = await resp.json();
    if (Array.isArray(json?.content)) this.messages.push({ role: "assistant", content: json.content });
    return extractAnthropicToolCalls(json);
  }

  submitToolResults(results: Array<{ call: ToolCall; output: string }>): void {
    this.messages.push({
      role: "user",
      content: results.map((r) => ({ type: "tool_result", tool_use_id: r.call.id, content: r.output })),
    });
  }
}

export class GoogleToolDriver implements ToolDriver {
  private contents: any[];
  constructor(
    private model: string,
    private apiKey: string,
    messages: ChatMessage[],
    context: LlmContext
  ) {
    this.contents = [{ role: "user", parts: [{ text: initialUserContent(messages, context) }] }];
  }

  async step(signal?: AbortSignal): Promise<{ toolCalls: ToolCall[]; text: string }> {
    const body = {
      system_instruction: { parts: [{ text: TOOL_SYSTEM_PROMPT }] },
      contents: this.contents,
      tools: buildGoogleTools(),
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const resp = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
    if (!resp.ok) throw new Error(`Google tool call failed: ${resp.status} ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    const json = await resp.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) this.contents.push({ role: "model", parts });
    return extractGoogleToolCalls(json);
  }

  submitToolResults(results: Array<{ call: ToolCall; output: string }>): void {
    this.contents.push({
      role: "user",
      parts: results.map((r) => ({ functionResponse: { name: r.call.name, response: { content: r.output } } })),
    });
  }
}

export { executeServerTool };
