import { describe, expect, it, vi } from "vitest";
import { decodeBase64Utf8, encodeBase64Utf8, escapeHtml, renderLineDiff, renderMarkdown } from "../src/toolbar/render-utils.js";

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

  it("renders diffs with escaped content", () => {
    const html = renderLineDiff("<old>", "<new>");

    expect(html).toContain("&lt;old&gt;");
    expect(html).toContain("&lt;new&gt;");
  });

  it("escapes message text before markdown transforms", () => {
    const html = renderMarkdown("**ok** <script>alert(1)</script>");

    expect(html).toContain("<strong>ok</strong>");
    expect(html).toContain("&lt;script&gt;");
  });
});
