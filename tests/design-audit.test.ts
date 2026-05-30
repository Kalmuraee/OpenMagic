import { describe, expect, it } from "vitest";
import { summarizeDesignTokens, formatDesignTokensForPrompt, buildDesignReviewPrompt, type StyleSample } from "../src/toolbar/design-audit.js";

const samples: StyleSample[] = [
  { color: "#111", backgroundColor: "#fff", fontFamily: "Inter, sans-serif", fontSize: "16px", fontWeight: "400", borderRadius: "8px", boxShadow: "none" },
  { color: "#111", backgroundColor: "#fff", fontFamily: "Inter, sans-serif", fontSize: "14px", fontWeight: "400", borderRadius: "0px" },
  { color: "#555", backgroundColor: "#f5f5f5", fontFamily: "Inter", fontSize: "32px", fontWeight: "700", borderRadius: "8px", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" },
  { color: "transparent", backgroundColor: "rgba(0, 0, 0, 0)", fontSize: "16px", fontWeight: "600" },
];

describe("summarizeDesignTokens", () => {
  const t = summarizeDesignTokens(samples);

  it("ranks text colors by frequency and excludes transparent", () => {
    expect(t.colors[0].value).toBe("#111");
    expect(t.colors[0].count).toBe(2);
    expect(t.colors.some((c) => c.value === "transparent")).toBe(false);
  });

  it("collects backgrounds, excluding fully-transparent", () => {
    expect(t.backgrounds.map((b) => b.value)).toContain("#fff");
    expect(t.backgrounds.map((b) => b.value)).toContain("#f5f5f5");
    expect(t.backgrounds.some((b) => b.value.includes("rgba(0, 0, 0, 0)"))).toBe(false);
  });

  it("derives a sorted unique type scale and font families", () => {
    expect(t.fontSizes).toEqual(["14px", "16px", "32px"]);
    expect(t.fontFamilies).toContain("Inter");
    expect(t.fontWeights).toEqual(["400", "600", "700"]);
  });

  it("collects radii (excluding 0) and shadows (excluding none)", () => {
    expect(t.radii).toEqual(["8px"]);
    expect(t.shadows).toEqual(["0 1px 2px rgba(0,0,0,0.1)"]);
  });
});

describe("formatDesignTokensForPrompt", () => {
  it("renders a readable design-system block", () => {
    const out = formatDesignTokensForPrompt(summarizeDesignTokens(samples));
    expect(out).toContain("Inter");
    expect(out).toContain("#111");
    expect(out).toMatch(/type scale|sizes/i);
  });
});

describe("buildDesignReviewPrompt", () => {
  it("includes the designer brief, the consistency rule, and the detected tokens", () => {
    const prompt = buildDesignReviewPrompt(summarizeDesignTokens(samples), { pageTitle: "Dashboard" });
    expect(prompt.toLowerCase()).toContain("designer");
    expect(prompt.toLowerCase()).toMatch(/consistent|consistency|brand/);
    expect(prompt).toContain("Inter"); // detected tokens embedded
    expect(prompt.toLowerCase()).toMatch(/contrast|hierarchy|spacing|accessib/); // a real checklist
  });
});
