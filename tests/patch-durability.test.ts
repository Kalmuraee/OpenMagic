import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPatchGroup, clearPatchManifests, rollbackPatchGroup, rollbackChain } from "../src/patch.js";

const ROOT = join(process.cwd(), ".test-durable-root");
const MANIFEST_DIR = join(process.cwd(), ".test-durable-manifests");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(MANIFEST_DIR, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  process.env.OPENMAGIC_MANIFEST_DIR = MANIFEST_DIR;
});

afterEach(() => {
  clearPatchManifests();
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(MANIFEST_DIR, { recursive: true, force: true });
  delete process.env.OPENMAGIC_MANIFEST_DIR;
});

describe("durable patch manifests", () => {
  it("persists a manifest to disk on apply", () => {
    writeFileSync(join(ROOT, "a.ts"), "const x = 1;\n");
    const res = applyPatchGroup(ROOT, {
      patches: [{ type: "replace", file: "a.ts", search: "const x = 1;", replace: "const x = 2;" }],
    });
    expect(res.applied).toBe(true);
    const files = readdirSync(MANIFEST_DIR);
    expect(files.some((f) => f === `${res.groupId}.json`)).toBe(true);
  });

  it("can roll back after the in-memory map is lost (simulated restart)", () => {
    writeFileSync(join(ROOT, "a.ts"), "const x = 1;\n");
    const res = applyPatchGroup(ROOT, {
      patches: [{ type: "replace", file: "a.ts", search: "const x = 1;", replace: "const x = 2;" }],
    });
    expect(readFileSync(join(ROOT, "a.ts"), "utf-8")).toContain("const x = 2;");

    clearPatchManifests(); // wipe RAM as a restart would

    const rb = rollbackPatchGroup(ROOT, res.groupId!);
    expect(rb.ok).toBe(true);
    expect(readFileSync(join(ROOT, "a.ts"), "utf-8")).toContain("const x = 1;");
    // disk manifest cleaned up after rollback
    expect(existsSync(join(MANIFEST_DIR, `${res.groupId}.json`))).toBe(false);
  });

  it("rolls back a self-correction chain to the original (pre-parent) content", () => {
    writeFileSync(join(ROOT, "a.ts"), "value = ORIGINAL;\n");

    const round1 = applyPatchGroup(ROOT, {
      patches: [{ type: "replace", file: "a.ts", search: "value = ORIGINAL;", replace: "value = ROUND1;" }],
    });
    expect(round1.applied).toBe(true);

    const round2 = applyPatchGroup(ROOT, {
      patches: [{ type: "replace", file: "a.ts", search: "value = ROUND1;", replace: "value = ROUND2;" }],
      parentGroupId: round1.groupId,
    });
    expect(round2.applied).toBe(true);
    expect(readFileSync(join(ROOT, "a.ts"), "utf-8")).toContain("ROUND2");

    // Rolling back the chain from the latest group restores the original content.
    const rb = rollbackChain(ROOT, round2.groupId!);
    expect(rb.ok).toBe(true);
    expect(readFileSync(join(ROOT, "a.ts"), "utf-8")).toContain("value = ORIGINAL;");
  });
});
