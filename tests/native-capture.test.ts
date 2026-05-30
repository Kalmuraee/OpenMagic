import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGitRepo, isWorkingTreeClean, captureAndRevert } from "../src/llm/native-capture.js";

const ROOT = join(process.cwd(), ".test-native-root");

function git(args: string) {
  execSync(`git -c user.email=t@t.co -c user.name=t ${args}`, { cwd: ROOT, stdio: "ignore" });
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  git("init -q");
  writeFileSync(join(ROOT, "app.ts"), "export const value = 1;\n");
  git("add -A");
  git("commit -q -m initial");
});
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("git helpers", () => {
  it("detects a git repo and a non-repo", () => {
    expect(isGitRepo(ROOT)).toBe(true);
    // tmpdir is outside any git work tree
    const nonRepo = mkdtempSync(join(tmpdir(), "om-nonrepo-"));
    try {
      expect(isGitRepo(nonRepo)).toBe(false);
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it("reports a clean vs dirty working tree", () => {
    expect(isWorkingTreeClean(ROOT)).toBe(true);
    writeFileSync(join(ROOT, "app.ts"), "export const value = 2;\n");
    expect(isWorkingTreeClean(ROOT)).toBe(false);
  });
});

describe("captureAndRevert", () => {
  it("captures an edit to a tracked file and reverts the working tree", () => {
    // simulate a CLI agent editing a tracked file
    writeFileSync(join(ROOT, "app.ts"), "export const value = 42;\n");

    const mods = captureAndRevert(ROOT);

    const edit = mods.find((m) => m.file === "app.ts");
    expect(edit).toBeTruthy();
    expect(edit!.type).toBe("edit");
    expect(edit!.search).toBe("export const value = 1;\n");
    expect(edit!.replace).toBe("export const value = 42;\n");

    // working tree reverted to the committed state
    expect(readFileSync(join(ROOT, "app.ts"), "utf-8")).toBe("export const value = 1;\n");
    expect(isWorkingTreeClean(ROOT)).toBe(true);
  });

  it("captures a newly created file as a create and removes it on revert", () => {
    writeFileSync(join(ROOT, "new.ts"), "export const added = true;\n");

    const mods = captureAndRevert(ROOT);

    const create = mods.find((m) => m.file === "new.ts");
    expect(create).toBeTruthy();
    expect(create!.type).toBe("create");
    expect(create!.content).toBe("export const added = true;\n");

    // the file is gone after revert (we'll re-create it through the review pipeline)
    expect(existsSync(join(ROOT, "new.ts"))).toBe(false);
  });

  it("returns no modifications when the agent changed nothing", () => {
    expect(captureAndRevert(ROOT)).toEqual([]);
  });
});
