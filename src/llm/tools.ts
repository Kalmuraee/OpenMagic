import { join } from "node:path";
import { grepFiles, listFiles, readFileSafe } from "../filesystem.js";
import { findSymbol, getSymbolIndex } from "../symbol-index.js";
import type { CodeModification } from "../shared-types.js";
import { displayPathFor, resolveProjectPath } from "../root-resolver.js";

/**
 * H11: native tool-calling. Instead of hand-writing a JSON contract and scraping
 * it back with brace-repair, tool-capable models call these JSON-schema tools,
 * read EXACT untruncated file contents as tool results, and propose edits against
 * code they actually saw. Backed by the same sandboxed filesystem handlers.
 */

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecution {
  content: string;            // tool result text fed back to the model
  terminal?: boolean;         // propose_edits ends the loop
  modifications?: CodeModification[];
  explanation?: string;
}

interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "read_file",
    description: "Read an exact page of a source file. Use offset/limit repeatedly until no MORE_AVAILABLE marker remains before proposing a byte-exact edit.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root" },
        offset: { type: "integer", minimum: 0, description: "Character offset (default 0)" },
        limit: { type: "integer", minimum: 1, maximum: 16000, description: "Characters to return (default/max 16000)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description: "Search the codebase for a text/substring pattern; returns matching file:line results.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Optional sub-directory to scope the search" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_dir",
    description: "List files under a directory (relative to project root).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
    },
  },
  {
    name: "find_symbol",
    description: "Locate the file(s) that export a named symbol — component, function, class, type, or constant. Use this to jump straight to the source for a component you see in the UI.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "propose_edits",
    description: "Propose the final code modifications. Call this exactly once when you know the precise edits. Copy each search block byte-for-byte from a file you read.",
    parameters: {
      type: "object",
      properties: {
        modifications: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              type: { type: "string", enum: ["edit", "create", "delete"] },
              search: { type: "string" },
              replace: { type: "string" },
              content: { type: "string" },
            },
            required: ["file", "type"],
          },
        },
        explanation: { type: "string" },
      },
      required: ["modifications", "explanation"],
    },
  },
];

const MAX_TOOL_FILE_CHARS = 16000;

export function executeServerTool(
  name: string,
  args: Record<string, unknown>,
  root: string,
  roots: string[]
): ToolExecution {
  switch (name) {
    case "read_file": {
      const rel = String(args.path || "");
      const resolved = resolveProjectPath(rel, roots, { mustExist: true });
      if ("error" in resolved) return { content: `Error reading ${rel}: ${resolved.error}` };
      const read = readFileSafe(resolved.absolutePath, [resolved.root]);
      if ("error" in read) return { content: `Error reading ${rel}: ${read.error}` };
      const offset = Math.max(0, Number.isFinite(Number(args.offset)) ? Math.floor(Number(args.offset)) : 0);
      const limit = Math.min(MAX_TOOL_FILE_CHARS, Math.max(1, Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : MAX_TOOL_FILE_CHARS));
      const chunk = read.content.slice(offset, offset + limit);
      const nextOffset = offset + chunk.length < read.content.length ? offset + chunk.length : null;
      return {
        content: `Contents of ${resolved.displayPath} [${offset}:${offset + chunk.length}] of ${read.content.length}:
${chunk}` +
          (nextOffset === null ? "" : `
[MORE_AVAILABLE next_offset=${nextOffset}]`),
      };
    }
    case "search_code": {
      const pattern = String(args.pattern || "");
      let results: Array<{ file: string; lineNum: number; line: string }> = [];
      if (args.path) {
        const resolved = resolveProjectPath(String(args.path), roots, { mustExist: true });
        if ("error" in resolved) return { content: `Search path error: ${resolved.error}` };
        results = grepFiles(pattern, resolved.absolutePath, [resolved.root])
          .map((match) => ({ ...match, file: displayPathFor(resolved.root, match.file, roots) }));
      } else {
        results = roots.flatMap((candidate) => grepFiles(pattern, candidate, [candidate])
          .map((match) => ({ ...match, file: displayPathFor(candidate, match.file, roots) })));
      }
      if (!results.length) return { content: `No matches for "${pattern}".` };
      return { content: results.map((r) => `${r.file}:${r.lineNum}: ${r.line}`).join("\n") };
    }
    case "list_dir": {
      if (args.path) {
        const resolved = resolveProjectPath(String(args.path), roots, { mustExist: true });
        if ("error" in resolved) return { content: `List path error: ${resolved.error}` };
        const entries = listFiles(resolved.absolutePath, [resolved.root], 3);
        if (!entries.length) return { content: "No files found." };
        return { content: entries.map((entry) => `${entry.type === "dir" ? "[dir] " : ""}${displayPathFor(resolved.root, entry.path, roots)}`).join("\n") };
      }
      const entries = roots.flatMap((candidate) => listFiles(candidate, [candidate], 3)
        .map((entry) => ({ ...entry, path: displayPathFor(candidate, entry.path, roots) })));
      if (!entries.length) return { content: "No files found." };
      return { content: entries.map((entry) => `${entry.type === "dir" ? "[dir] " : ""}${entry.path}`).join("\n") };
    }
    case "find_symbol": {
      const entries = findSymbol(getSymbolIndex(root, roots), String(args.name || ""));
      if (!entries.length) return { content: `No exported symbol named "${args.name}".` };
      return { content: entries.map((e) => `${e.name} (${e.kind}) — ${e.file}`).join("\n") };
    }
    case "propose_edits": {
      const mods = Array.isArray(args.modifications) ? (args.modifications as CodeModification[]) : [];
      return { content: "Edits proposed.", terminal: true, modifications: mods, explanation: String(args.explanation || "") };
    }
    default:
      return { content: `Unknown tool: ${name}` };
  }
}

// ---- Per-provider serialization ----

export function buildOpenAiTools(): unknown[] {
  return TOOL_SPECS.map((s) => ({
    type: "function",
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
}

export function buildAnthropicTools(): any[] {
  return TOOL_SPECS.map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));
}

export function buildGoogleTools(): any[] {
  return [{ functionDeclarations: TOOL_SPECS.map((s) => ({ name: s.name, description: s.description, parameters: s.parameters })) }];
}

// ---- Per-provider tool-call extraction (from a non-streamed response) ----

function safeParse(json: unknown): Record<string, unknown> {
  if (typeof json !== "string") return (json as Record<string, unknown>) || {};
  try { return JSON.parse(json); } catch { return {}; }
}

export function extractOpenAiToolCalls(resp: any): { toolCalls: ToolCall[]; text: string } {
  const message = resp?.choices?.[0]?.message || {};
  const toolCalls: ToolCall[] = (message.tool_calls || []).map((tc: any, i: number) => ({
    id: tc.id || `call_${i}`,
    name: tc.function?.name || "",
    arguments: safeParse(tc.function?.arguments),
  }));
  return { toolCalls, text: typeof message.content === "string" ? message.content : "" };
}

export function extractAnthropicToolCalls(resp: any): { toolCalls: ToolCall[]; text: string } {
  const blocks: any[] = Array.isArray(resp?.content) ? resp.content : [];
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, arguments: (b.input as Record<string, unknown>) || {} }));
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { toolCalls, text };
}

export function extractGoogleToolCalls(resp: any): { toolCalls: ToolCall[]; text: string } {
  const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `fc_${i}`, name: p.functionCall.name, arguments: (p.functionCall.args as Record<string, unknown>) || {} }));
  const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
  return { toolCalls, text };
}
