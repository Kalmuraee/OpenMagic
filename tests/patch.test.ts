import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPatchGroup, clearPatchManifests, previewPatch, rollbackPatchGroup } from "../src/patch.js";

const ROOT = join(process.cwd(), ".test-patch-root");
const OUTSIDE = join(process.cwd(), ".test-patch-outside");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
});

afterEach(() => {
  clearPatchManifests();
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

describe("patch preview", () => {
  it("previews an exact replace", () => {
    writeFileSync(join(ROOT, "app.ts"), "const value = 1;\n");

    const result = previewPatch(ROOT, {
      type: "replace",
      file: "app.ts",
      search: "const value = 1;",
      replace: "const value = 2;",
    });

    expect(result.ok).toBe(true);
    expect(result.changes[0]).toMatchObject({ ok: true, confidence: 1 });
  });

  it("rejects ambiguous repeated search blocks", () => {
    writeFileSync(join(ROOT, "app.ts"), "same();\nsame();\n");

    const result = previewPatch(ROOT, {
      type: "replace",
      file: "app.ts",
      search: "same();",
      replace: "different();",
    });

    expect(result.ok).toBe(false);
    expect(result.changes[0].reason).toContain("ambiguous");
  });
});

describe("patch apply", () => {
  it("applies replace, create, and delete patches", () => {
    writeFileSync(join(ROOT, "app.ts"), "const value = 1;\n");
    writeFileSync(join(ROOT, "old.ts"), "remove me\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "replace", file: "app.ts", search: "const value = 1;", replace: "const value = 2;" },
        { type: "create", file: "new.ts", content: "new file\n" },
        { type: "delete", file: "old.ts" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(true);
    expect(readFileSync(join(ROOT, "app.ts"), "utf-8")).toBe("const value = 2;\n");
    expect(readFileSync(join(ROOT, "new.ts"), "utf-8")).toBe("new file\n");
    expect(existsSync(join(ROOT, "old.ts"))).toBe(false);
  });

  it("rolls back prior writes when one patch in a group fails", () => {
    writeFileSync(join(ROOT, "app.ts"), "const value = 1;\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "replace", file: "app.ts", search: "const value = 1;", replace: "const value = 2;" },
        { type: "replace", file: "missing.ts", search: "x", replace: "y" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(readFileSync(join(ROOT, "app.ts"), "utf-8")).toBe("const value = 1;\n");
  });

  it("restores all files in a rollback group", () => {
    writeFileSync(join(ROOT, "app.ts"), "const value = 1;\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "replace", file: "app.ts", search: "const value = 1;", replace: "const value = 2;" },
        { type: "create", file: "new.ts", content: "new file\n" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.groupId).toBeTruthy();

    const rollback = rollbackPatchGroup(ROOT, result.groupId!);

    expect(rollback.ok).toBe(true);
    expect(readFileSync(join(ROOT, "app.ts"), "utf-8")).toBe("const value = 1;\n");
    expect(existsSync(join(ROOT, "new.ts"))).toBe(false);
  });

  it("preserves CRLF and BOM metadata through patch writes", () => {
    const filePath = join(ROOT, "windows.txt");
    writeFileSync(filePath, "\uFEFFone\r\ntwo\r\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "replace", file: "windows.txt", search: "two", replace: "three" },
      ],
    });

    expect(result.ok).toBe(true);
    const raw = readFileSync(filePath);
    expect(raw[0]).toBe(0xEF);
    expect(raw[1]).toBe(0xBB);
    expect(raw[2]).toBe(0xBF);
    expect(raw.toString("utf-8")).toContain("one\r\nthree\r\n");
  });

  it("applies a whitespace-normalized replace", () => {
    writeFileSync(join(ROOT, "spaces.ts"), "  export const value = 1;   \n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "replace", file: "spaces.ts", search: "export const value = 1;   ", replace: "export const value = 2;" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(ROOT, "spaces.ts"), "utf-8")).toBe("  export const value = 2;\n");
  });

  it("adjusts replacement indentation when the search block indentation is wrong", () => {
    writeFileSync(join(ROOT, "indent.ts"), "function demo() {\n\tif (ready) {\n\t\treturn one();\n\t}\n}\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        {
          type: "replace",
          file: "indent.ts",
          search: "if (ready) {\n  return one();\n}",
          replace: "if (ready) {\n  return two();\n}",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(ROOT, "indent.ts"), "utf-8")).toContain("\tif (ready) {\n\t\treturn two();\n\t}");
  });

  it("applies fuzzy replacement for a high-confidence near match", () => {
    writeFileSync(join(ROOT, "fuzzy.ts"), "export function total() {\n  return price + tax;\n}\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        {
          type: "replace",
          file: "fuzzy.ts",
          search: "export function total() {\n  return price + taxes;\n}",
          replace: "export function total() {\n  return price + shipping + tax;\n}",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(ROOT, "fuzzy.ts"), "utf-8")).toContain("price + shipping + tax");
  });

  it("handles unicode and blank lines in replacement blocks", () => {
    writeFileSync(join(ROOT, "unicode.ts"), "const label = \"مرحبا\";\n\nconst emoji = \"✨\";\n");

    const result = applyPatchGroup(ROOT, {
      patches: [
        {
          type: "replace",
          file: "unicode.ts",
          search: "const label = \"مرحبا\";\n\nconst emoji = \"✨\";",
          replace: "const label = \"أهلا\";\n\nconst emoji = \"🪄\";",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(ROOT, "unicode.ts"), "utf-8")).toContain("أهلا");
    expect(readFileSync(join(ROOT, "unicode.ts"), "utf-8")).toContain("🪄");
  });

  it("edits a large file in the middle", () => {
    const before = Array.from({ length: 1200 }, (_, i) => `before${i}`).join("\n");
    const after = Array.from({ length: 1200 }, (_, i) => `after${i}`).join("\n");
    writeFileSync(join(ROOT, "large.ts"), `${before}\nconst middle = true;\n${after}\n`);

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "replace", file: "large.ts", search: "const middle = true;", replace: "const middle = false;" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(ROOT, "large.ts"), "utf-8")).toContain("const middle = false;");
  });

  it("rejects patch targets under symlinked escape paths", () => {
    symlinkSync(OUTSIDE, join(ROOT, "escape-link"));

    const result = applyPatchGroup(ROOT, {
      patches: [
        { type: "create", file: "escape-link/new.ts", content: "escaped\n" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.applied).toBe(false);
    expect(existsSync(join(OUTSIDE, "new.ts"))).toBe(false);
  });
});
