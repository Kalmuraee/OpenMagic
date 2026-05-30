import { describe, it, expect } from "vitest";
import { extractJsonFromResponse, parseLlmResponse } from "../src/llm/proxy.js";

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

describe("parseLlmResponse — parse-status honesty", () => {
  it("reports clean for a well-formed object (even with zero modifications)", () => {
    const r = parseLlmResponse('{"modifications":[],"explanation":"No change needed"}');
    expect(r.status).toBe("clean");
    expect(r.modifications).toEqual([]);
    expect(r.explanation).toBe("No change needed");
  });

  it("reports clean for a well-formed object with modifications", () => {
    const r = parseLlmResponse(
      '{"modifications":[{"file":"a.tsx","type":"edit","search":"old","replace":"new"}],"explanation":"Updated"}'
    );
    expect(r.status).toBe("clean");
    expect(r.modifications).toHaveLength(1);
  });

  it("reports clean for markdown-fenced JSON", () => {
    const r = parseLlmResponse('```json\n{"modifications":[],"explanation":"Fixed"}\n```');
    expect(r.status).toBe("clean");
    expect(r.explanation).toBe("Fixed");
  });

  it("reports clean for a balanced object embedded in prose", () => {
    const r = parseLlmResponse(
      'Sure: {"modifications":[],"explanation":"ok"} hope that helps'
    );
    expect(r.status).toBe("clean");
  });

  it("reports truncated when braces/strings had to be repaired", () => {
    // explanation string is never closed → stream was cut mid-object
    const r = parseLlmResponse('{"modifications":[],"explanation":"I was still writing this when the str');
    expect(r.status).toBe("truncated");
    expect(r.modifications).toEqual([]);
  });

  it("reports salvaged when only the explanation could be regex-recovered", () => {
    const r = parseLlmResponse('{"modifications": invalid-json, "explanation": "I edited App.tsx"}');
    expect(r.status).toBe("salvaged");
    expect(r.explanation).toContain("I edited App.tsx");
    expect(r.modifications).toEqual([]);
  });

  it("reports failed when nothing parseable is present", () => {
    const r = parseLlmResponse("I'm sorry, I can't help with that.");
    expect(r.status).toBe("failed");
    expect(r.json).toBeNull();
    expect(r.modifications).toEqual([]);
    expect(r.explanation).toBe("");
  });

  it("keeps extractJsonFromResponse and parseLlmResponse consistent on the JSON string", () => {
    const input = '{"modifications":[],"explanation":"x"}';
    expect(parseLlmResponse(input).json).toBe(extractJsonFromResponse(input));
  });
});
