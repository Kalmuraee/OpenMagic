import { describe, it, expect } from "vitest";
import { extractJsonFromResponse } from "../src/llm/proxy.js";

describe("JSON extraction from LLM responses", () => {
  it("parses clean JSON", () => {
    const input = '{"modifications":[],"explanation":"Done"}';
    const result = extractJsonFromResponse(input);
    expect(result).toBe(input);
  });

  it("extracts JSON from markdown code block", () => {
    const input = 'Here is my response:\n```json\n{"modifications":[],"explanation":"Fixed"}\n```\nDone.';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).explanation).toBe("Fixed");
  });

  it("extracts JSON embedded in text", () => {
    const input = 'I made the changes: {"modifications":[{"file":"a.tsx","type":"edit","search":"old","replace":"new"}],"explanation":"Updated"} Hope that helps!';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.modifications.length).toBe(1);
  });

  it("repairs truncated JSON (missing closing braces)", () => {
    const input = '{"modifications":[],"explanation":"I need to see the file NEED_FILE: src/app/page.tsx';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.modifications).toEqual([]);
  });

  it("extracts explanation via regex when JSON is malformed", () => {
    const input = '{"modifications": invalid, "explanation": "NEED_FILE: src/app/page.tsx"}';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.explanation).toContain("NEED_FILE");
  });

  it("returns null for completely non-JSON content", () => {
    const input = "I'm sorry, I can't help with that.";
    const result = extractJsonFromResponse(input);
    expect(result).toBeNull();
  });

  it("handles escaped quotes in JSON strings", () => {
    const input = '{"modifications":[],"explanation":"SEARCH_FILES: \\"nav-group\\" in src/"}';
    const result = extractJsonFromResponse(input);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.explanation).toContain("nav-group");
  });
});
