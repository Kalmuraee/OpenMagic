import { describe, expect, it } from "vitest";
import {
  EDITABLE_STYLE_PROPS,
  diffElementState,
  describeElementChanges,
  changesToCssText,
  type ElementState,
} from "../src/toolbar/element-editor.js";

const base = (over: Partial<ElementState> = {}): ElementState => ({
  styles: {},
  text: "",
  className: "",
  attributes: {},
  ...over,
});

describe("EDITABLE_STYLE_PROPS", () => {
  it("covers the common editable CSS properties", () => {
    for (const p of ["color", "background-color", "font-size", "padding", "margin", "border-radius"]) {
      expect(EDITABLE_STYLE_PROPS).toContain(p);
    }
  });
});

describe("diffElementState", () => {
  it("detects a style change", () => {
    const changes = diffElementState(base({ styles: { color: "red" } }), base({ styles: { color: "blue" } }));
    expect(changes).toEqual([{ kind: "style", name: "color", from: "red", to: "blue" }]);
  });

  it("detects text, class, and attribute changes", () => {
    const before = base({ text: "Sign up", className: "btn", attributes: { href: "/old" } });
    const after = base({ text: "Join now", className: "btn primary", attributes: { href: "/new" } });
    const changes = diffElementState(before, after);
    expect(changes).toContainEqual({ kind: "text", name: "", from: "Sign up", to: "Join now" });
    expect(changes).toContainEqual({ kind: "class", name: "", from: "btn", to: "btn primary" });
    expect(changes).toContainEqual({ kind: "attribute", name: "href", from: "/old", to: "/new" });
  });

  it("returns nothing when there are no changes", () => {
    const s = base({ styles: { color: "red" }, text: "x" });
    expect(diffElementState(s, { ...s, styles: { ...s.styles } })).toEqual([]);
  });

  it("treats a newly-set style (no prior value) as a change", () => {
    const changes = diffElementState(base(), base({ styles: { "font-weight": "700" } }));
    expect(changes).toEqual([{ kind: "style", name: "font-weight", from: "", to: "700" }]);
  });
});

describe("changesToCssText", () => {
  it("serializes only style changes into a CSS declaration string", () => {
    const css = changesToCssText([
      { kind: "style", name: "color", from: "red", to: "blue" },
      { kind: "style", name: "font-size", from: "", to: "18px" },
      { kind: "text", name: "", from: "a", to: "b" },
    ]);
    expect(css).toBe("color: blue; font-size: 18px;");
  });
});

describe("describeElementChanges", () => {
  it("produces an LLM instruction listing each change", () => {
    const prompt = describeElementChanges("button.cta", [
      { kind: "style", name: "color", from: "red", to: "blue" },
      { kind: "text", name: "", from: "Sign up", to: "Join now" },
    ]);
    expect(prompt).toContain("button.cta");
    expect(prompt).toContain("color");
    expect(prompt).toContain("blue");
    expect(prompt).toContain("Join now");
  });
});
