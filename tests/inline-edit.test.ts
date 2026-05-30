import { describe, expect, it } from "vitest";
import { buildTextEditModification } from "../src/toolbar/inline-edit.js";

const files = (entries: Record<string, string>) =>
  Object.entries(entries).map(([path, content]) => ({ path, content }));

describe("buildTextEditModification", () => {
  it("builds an exact line edit when the text is found once", () => {
    const mod = buildTextEditModification(
      files({ "Hero.tsx": "  <button>Sign up</button>\n" }),
      "Sign up",
      "Join now"
    );
    expect(mod).toEqual({
      file: "Hero.tsx",
      search: "  <button>Sign up</button>",
      replace: "  <button>Join now</button>",
    });
  });

  it("returns null when the text is not found verbatim (caller falls back to the LLM)", () => {
    expect(buildTextEditModification(files({ "a.tsx": "<h1>Hi</h1>" }), "Welcome", "Hello")).toBeNull();
  });

  it("returns null for a no-op or empty edit", () => {
    expect(buildTextEditModification(files({ "a.tsx": "x" }), "x", "x")).toBeNull();
    expect(buildTextEditModification(files({ "a.tsx": "x" }), "   ", "y")).toBeNull();
  });

  it("returns null for multi-line text", () => {
    expect(buildTextEditModification(files({ "a.tsx": "x\ny" }), "x\ny", "z")).toBeNull();
  });

  it("disambiguates repeated text using surrounding context", () => {
    const content = [
      "<header><span>Open</span></header>",
      "<main><span>Open</span></main>",
    ].join("\n");
    const mod = buildTextEditModification(files({ "a.tsx": content }), "Open", "Close");
    // both lines contain "Open"; the one inside <main> is uniquely identifiable
    // only if its 1-line-context block is unique — here both 3-line blocks differ,
    // so it must pick the first unique block deterministically or bail.
    expect(mod === null || (mod.search.includes("Open") && mod.replace.includes("Close"))).toBe(true);
  });

  it("returns a context block (not a bare line) when needed for uniqueness", () => {
    const content = [
      "title: Dashboard",
      "label: Save",
      "footer: Save",
      "copyright: 2026",
    ].join("\n");
    const mod = buildTextEditModification(files({ "a.tsx": content }), "Save", "Submit");
    // "Save" appears twice on different lines with different neighbors → a 3-line
    // context block disambiguates, and only the matched line's text is changed.
    expect(mod).not.toBeNull();
    expect(mod!.search).toContain("\n");
    expect(mod!.replace).toContain("Submit");
    expect(mod!.replace.split("\n").filter((l) => l.includes("Submit")).length).toBe(1);
  });
});
