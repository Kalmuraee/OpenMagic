import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureFileSnapshotSafe, restoreFileSnapshotSafe } from "../src/filesystem.js";
import { applyPatchGroup, clearPatchManifests, rollbackPatchGroup } from "../src/patch.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openmagic-empty-snapshot-"));
  const manifests = join(root, "manifests");
  mkdirSync(manifests);
  vi.stubEnv("OPENMAGIC_MANIFEST_DIR", manifests);
});

afterEach(() => {
  clearPatchManifests();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("empty snapshot recovery", () => {
  it.each([false, true])("restores empty bytes after deletion=%s", (deleted) => {
    const path = join(root, "empty.txt");
    writeFileSync(path, "");
    const snapshot = captureFileSnapshotSafe(path, [root]);
    expect(snapshot).toMatchObject({ existed: true, contentBase64: "" });
    if ("error" in snapshot) throw new Error(snapshot.error);
    if (deleted) unlinkSync(path);
    else writeFileSync(path, "changed");
    expect(restoreFileSnapshotSafe(path, snapshot, [root]).ok).toBe(true);
    expect(readFileSync(path)).toEqual(Buffer.alloc(0));
  });

  it("still rejects missing snapshot content without changing the target", () => {
    const path = join(root, "keep.txt");
    writeFileSync(path, "keep");
    expect(restoreFileSnapshotSafe(path, { existed: true }, [root])).toEqual({
      ok: false, error: "Snapshot content is missing",
    });
    expect(readFileSync(path, "utf8")).toBe("keep");
  });

  it.each([false, true])("undoes a group containing an empty-file deletion after cache reset=%s", (restart) => {
    writeFileSync(join(root, "first.txt"), "before");
    writeFileSync(join(root, "empty.txt"), "");
    const result = applyPatchGroup(root, { patches: [
      { type: "replace", file: "first.txt", search: "before", replace: "after" },
      { type: "delete", file: "empty.txt" },
    ] });
    expect(result.applied).toBe(true);
    expect(existsSync(join(root, "empty.txt"))).toBe(false);
    if (restart) clearPatchManifests();
    expect(rollbackPatchGroup(root, result.groupId!).ok).toBe(true);
    expect(readFileSync(join(root, "first.txt"), "utf8")).toBe("before");
    expect(readFileSync(join(root, "empty.txt"))).toEqual(Buffer.alloc(0));
  });
});
