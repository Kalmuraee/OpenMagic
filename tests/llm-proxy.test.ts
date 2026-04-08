import { describe, it, expect } from "vitest";

// Test the JSON extraction logic directly
// We inline the function here since it's not exported

function extractJsonFromResponse(content: string): string | null {
  try { JSON.parse(content); return content; } catch {}

  const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch?.[1]) {
    const candidate = mdMatch[1].trim();
    try { JSON.parse(candidate); return candidate; } catch {}
  }

  const start = content.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = content.substring(start, i + 1);
        try { JSON.parse(candidate); return candidate; } catch { break; }
      }
    }
  }

  if (depth > 0) {
    let repaired = content.substring(start);
    if (inString) repaired += '"';
    while (depth > 0) { repaired += '}'; depth--; }
    try { JSON.parse(repaired); return repaired; } catch {}
  }

  const explMatch = content.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (explMatch) {
    return JSON.stringify({ modifications: [], explanation: JSON.parse('"' + explMatch[1] + '"') });
  }

  return null;
}

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
