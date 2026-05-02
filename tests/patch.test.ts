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
