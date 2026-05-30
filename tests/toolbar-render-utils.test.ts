import { describe, expect, it, vi } from "vitest";
import { computeLineDiff, decodeBase64Utf8, encodeBase64Utf8, escapeHtml, highlightCode, renderLineDiff, renderMarkdown } from "../src/toolbar/render-utils.js";

vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));

describe("toolbar render utilities", () => {
  it("round-trips unicode base64 payloads", () => {
    const value = "hello مرحبا";

    expect(decodeBase64Utf8(encodeBase64Utf8(value))).toBe(value);
  });

  it("escapes unsafe HTML", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("renders diffs with escaped content (no raw HTML injection)", () => {
    const html = renderLineDiff("<img src=x onerror=alert(1)>", "<b>bold</b>");

    // the real invariant: nothing from the diff input is emitted as live HTML
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;bold");
  });

  it("escapes message text before markdown transforms", () => {
    const html = renderMarkdown("**ok** <script>alert(1)</script>");

    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("computeLineDiff (LCS line alignment)", () => {
  it("marks identical content as context with matching line numbers", () => {
    const rows = computeLineDiff("a\nb", "a\nb");
    expect(rows.every((r) => r.kind === "context")).toBe(true);
    expect(rows.map((r) => [r.oldNo, r.newNo])).toEqual([[1, 1], [2, 2]]);
  });

  it("keeps unchanged interior lines as context and isolates the real change", () => {
    const rows = computeLineDiff("a\nB\nc", "a\nX\nc");
    expect(rows.find((r) => r.text === "a")?.kind).toBe("context");
    expect(rows.find((r) => r.text === "c")?.kind).toBe("context");
    expect(rows.find((r) => r.text === "B")?.kind).toBe("del");
    expect(rows.find((r) => r.text === "X")?.kind).toBe("ins");
  });

  it("numbers the old and new sides independently across an insertion", () => {
    const rows = computeLineDiff("a\nc", "a\nb\nc");
    const ins = rows.find((r) => r.text === "b");
    expect(ins?.kind).toBe("ins");
    expect(ins?.oldNo).toBeUndefined();
    expect(ins?.newNo).toBe(2);
    expect(rows.find((r) => r.text === "c")).toMatchObject({ oldNo: 2, newNo: 3 });
  });
});

describe("highlightCode", () => {
  it("escapes HTML in code", () => {
    expect(highlightCode("<div>")).toContain("&lt;div&gt;");
    expect(highlightCode("<div>")).not.toContain("<div>");
  });
  it("wraps keywords, strings, and comments in token spans", () => {
    expect(highlightCode("const x = 1;")).toContain('om-tok-keyword">const');
    expect(highlightCode("const s = 'hi';")).toContain("om-tok-string");
    expect(highlightCode("// note")).toContain("om-tok-comment");
  });
  it("does not highlight keywords inside strings", () => {
    const out = highlightCode("const s = 'const inside';");
    // the inner 'const' is part of a string token, not its own keyword span
    expect(out.match(/om-tok-keyword/g)?.length).toBe(1);
  });
});
