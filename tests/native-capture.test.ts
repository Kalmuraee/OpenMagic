
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureNativeEditSession,
  closeNativeEditSession,
  createNativeEditSession,
  isGitRepo,
  isNativeEditEligible,
  isWorkingTreeClean,
} from "../src/llm/native-capture.js";

const dirs: string[] = [];
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "om-native-test-"));
  dirs.push(root);
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "a.txt"), "one\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "base"], { cwd: root });
  return root;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("isolated native capture", () => {
  it("detects repository and cleanliness", () => {
    const root = repo();
    expect(isGitRepo(root)).toBe(true);
    expect(isWorkingTreeClean(root)).toBe(true);
    expect(isNativeEditEligible(root)).toBe(true);
  });

  it("blocks a dirty source checkout", () => {
    const root = repo();
    writeFileSync(join(root, "a.txt"), "dirty\n");
    expect(isNativeEditEligible(root)).toBe(false);
    expect(() => createNativeEditSession(root)).toThrow(/clean working tree/);
  });

  it("captures tracked and untracked changes without modifying source", () => {
    const root = repo();
    const session = createNativeEditSession(root);
    try {
      writeFileSync(join(session.workspace, "a.txt"), "two\n");
      writeFileSync(join(session.workspace, "new.txt"), "new\n");
      const mods = captureNativeEditSession(session);
      expect(mods.map((mod) => mod.type).sort()).toEqual(["create", "edit"]);
      expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("one\n");
    } finally {
      closeNativeEditSession(session);
    }
  });

  it("refuses ignored-file modifications", () => {
    const root = repo();
    writeFileSync(join(root, ".gitignore"), ".env\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: root });
    execFileSync("git", ["commit", "-m", "ignore env"], { cwd: root });
    const session = createNativeEditSession(root);
    try {
      writeFileSync(join(session.workspace, ".env"), "SECRET=x\n");
      expect(() => captureNativeEditSession(session)).toThrow(/ignored files/);
    } finally {
      closeNativeEditSession(session);
    }
  });
});
