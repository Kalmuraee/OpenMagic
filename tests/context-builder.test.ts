import { describe, it, expect } from "vitest";
import { buildContext, summarizeRuntimeFailure } from "../src/toolbar/services/context-builder.js";

// The full set of element fields that src/llm/prompts.ts:buildContextParts reads.
// buildContext must forward all of them or the prompt rules silently see undefined.
const PROMPT_FIELDS = [
  "cssSelector", "tagName", "id", "className", "outerHTML", "computedStyles",
  "ancestry", "componentHint", "parentStyles", "siblings", "matchedCssRules",
  "viewport", "ariaAttributes", "eventHandlers", "reactProps", "childrenLayout",
  "resolvedClasses", "themeState", "cssVariables", "stackingContext",
  "visibilityState", "activeBreakpoints", "pseudoElements", "formState",
];

function fullElement(): any {
  const el: any = {};
  for (const f of PROMPT_FIELDS) el[f] = `value-${f}`;
  // give the shape-sensitive ones plausible types
  el.computedStyles = { color: "red" };
  el.ancestry = ["div", "main"];
  el.siblings = [{ tag: "span" }];
  el.outerHTML = "<button>x</button>";
  return el;
}

describe("buildContext — full element forwarding (H2)", () => {
  it("forwards every element field that the prompt reads", () => {
    const ctx = buildContext(fullElement(), null);
    const forwarded = ctx.selectedElement as Record<string, unknown>;
    for (const field of PROMPT_FIELDS) {
      expect(forwarded, `missing field: ${field}`).toHaveProperty(field);
    }
  });

  it("returns undefined element when nothing is selected", () => {
    expect(buildContext(null, null).selectedElement).toBeUndefined();
  });

  it("caps very large outerHTML to keep the prompt bounded", () => {
    const el = fullElement();
    el.outerHTML = "x".repeat(20000);
    const ctx = buildContext(el, null);
    const forwarded = ctx.selectedElement as Record<string, string>;
    expect(forwarded.outerHTML.length).toBeLessThanOrEqual(8200);
  });
});

describe("summarizeRuntimeFailure (Phase 6 bridge)", () => {
  it("returns a summary when a framework error overlay is present", () => {
    const s = summarizeRuntimeFailure("ReferenceError: foo is not defined\n  at Hero.tsx:3", []);
    expect(s).toBeTruthy();
    expect(s).toContain("foo is not defined");
  });

  it("returns a summary from uncaught runtime errors when there is no overlay", () => {
    const s = summarizeRuntimeFailure(null, [
      { type: "error", message: "Cannot read properties of undefined (reading 'map')" },
    ]);
    expect(s).toBeTruthy();
    expect(s).toContain("Cannot read properties of undefined");
  });

  it("returns null when there is no runtime failure signal", () => {
    expect(summarizeRuntimeFailure(null, [])).toBeNull();
  });
});
