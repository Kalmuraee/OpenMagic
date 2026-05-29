import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOOL_SPECS,
  executeServerTool,
  buildOpenAiTools,
  buildAnthropicTools,
  buildGoogleTools,
  extractOpenAiToolCalls,
  extractAnthropicToolCalls,
  extractGoogleToolCalls,
} from "../src/llm/tools.js";

const ROOT = join(process.cwd(), ".test-tools-root");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "src"), { recursive: true });
  writeFileSync(join(ROOT, "src/app.ts"), "export const greeting = 'hello world';\n");
});
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("executeServerTool", () => {
  it("read_file returns the file contents", () => {
    const r = executeServerTool("read_file", { path: "src/app.ts" }, ROOT, [ROOT]);
    expect(r.content).toContain("hello world");
    expect(r.terminal).toBeFalsy();
  });
  it("read_file reports a missing file instead of throwing", () => {
    const r = executeServerTool("read_file", { path: "src/missing.ts" }, ROOT, [ROOT]);
    expect(r.content.toLowerCase()).toMatch(/not found|error/);
  });
  it("search_code finds matching lines", () => {
    const r = executeServerTool("search_code", { pattern: "greeting" }, ROOT, [ROOT]);
    expect(r.content).toContain("src/app.ts");
  });
  it("list_dir lists files", () => {
    const r = executeServerTool("list_dir", { path: "src" }, ROOT, [ROOT]);
    expect(r.content).toContain("app.ts");
  });
  it("propose_edits is terminal and returns the modifications", () => {
    const mods = [{ file: "src/app.ts", type: "edit", search: "hello", replace: "hi" }];
    const r = executeServerTool("propose_edits", { modifications: mods, explanation: "shorten" }, ROOT, [ROOT]);
    expect(r.terminal).toBe(true);
    expect(r.modifications).toEqual(mods);
    expect(r.explanation).toBe("shorten");
  });
  it("rejects path traversal in read_file", () => {
    const r = executeServerTool("read_file", { path: "../../etc/passwd" }, ROOT, [ROOT]);
    expect(r.content.toLowerCase()).toMatch(/not found|outside|error|denied/);
  });
});

describe("tool serializers expose all specs", () => {
  it("OpenAI format", () => {
    const tools = buildOpenAiTools();
    expect(tools).toHaveLength(TOOL_SPECS.length);
    expect(tools[0]).toMatchObject({ type: "function", function: { name: expect.any(String) } });
  });
  it("Anthropic format", () => {
    const tools = buildAnthropicTools();
    expect(tools[0]).toHaveProperty("input_schema");
    expect(tools.map((t: any) => t.name)).toContain("propose_edits");
  });
  it("Google format wraps functionDeclarations", () => {
    const tools = buildGoogleTools();
    expect(tools[0]).toHaveProperty("functionDeclarations");
    expect(tools[0].functionDeclarations).toHaveLength(TOOL_SPECS.length);
  });
});

describe("tool-call extraction", () => {
  it("OpenAI tool_calls", () => {
    const resp = { choices: [{ message: { content: null, tool_calls: [
      { id: "c1", function: { name: "read_file", arguments: '{"path":"src/app.ts"}' } },
    ] } }] };
    const { toolCalls, text } = extractOpenAiToolCalls(resp);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ id: "c1", name: "read_file", arguments: { path: "src/app.ts" } });
    expect(text).toBe("");
  });
  it("Anthropic tool_use blocks", () => {
    const resp = { content: [
      { type: "text", text: "let me look" },
      { type: "tool_use", id: "tu1", name: "search_code", input: { pattern: "x" } },
    ] };
    const { toolCalls, text } = extractAnthropicToolCalls(resp);
    expect(toolCalls[0]).toMatchObject({ id: "tu1", name: "search_code", arguments: { pattern: "x" } });
    expect(text).toContain("let me look");
  });
  it("Google functionCall parts", () => {
    const resp = { candidates: [{ content: { parts: [
      { text: "checking" },
      { functionCall: { name: "list_dir", args: { path: "src" } } },
    ] } }] };
    const { toolCalls, text } = extractGoogleToolCalls(resp);
    expect(toolCalls[0]).toMatchObject({ name: "list_dir", arguments: { path: "src" } });
    expect(text).toContain("checking");
  });
});
