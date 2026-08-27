
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodeModification } from "../shared-types.js";

function gitOut(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function isGitRepo(root: string): boolean {
  try { return gitOut(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true"; }
  catch { return false; }
}

export function isWorkingTreeClean(root: string): boolean {
  try { return gitOut(root, ["status", "--porcelain", "--untracked-files=all"]).trim() === ""; }
  catch { return false; }
}

export function isNativeEditEligible(root: string): boolean {
  return isGitRepo(root) && isWorkingTreeClean(root);
}

export interface NativeEditSession {
  sourceRoot: string;
  workspace: string;
  tempRoot: string;
  closed: boolean;
}

export function createNativeEditSession(root: string): NativeEditSession {
  if (!isNativeEditEligible(root)) {
    throw new Error("Native edit requires a Git repository with a clean working tree");
  }
  const tempRoot = mkdtempSync(join(tmpdir(), "openmagic-native-edit-"));
  const workspace = join(tempRoot, "worktree");
  try {
    gitOut(root, ["worktree", "add", "--detach", workspace, "HEAD"]);
    return { sourceRoot: root, workspace, tempRoot, closed: false };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function statusEntries(workspace: string): Array<{ code: string; file: string }> {
  const output = gitOut(workspace, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"]);
  return output.split("\n").filter(Boolean).map((line) => ({ code: line.slice(0, 2), file: line.slice(3).trim() }));
}

export function captureNativeEditSession(session: NativeEditSession): CodeModification[] {
  if (session.closed) throw new Error("Native edit session is already closed");
  const ignored = statusEntries(session.workspace).filter((entry) => entry.code === "!!");
  if (ignored.length) {
    throw new Error(`Agent modified ignored files; refusing to capture: ${ignored.slice(0, 5).map((entry) => entry.file).join(", ")}`);
  }

  const modifications: CodeModification[] = [];
  const changed = gitOut(session.workspace, ["diff", "HEAD", "--name-only", "--"]).split("\n").map((line) => line.trim()).filter(Boolean);
  for (const file of changed) {
    let before = "";
    try { before = gitOut(session.workspace, ["show", `HEAD:${file}`]); } catch {}
    const absolute = join(session.workspace, file);
    if (existsSync(absolute)) {
      const after = readFileSync(absolute, "utf-8");
      if (after !== before) modifications.push({ file, type: "edit", search: before, replace: after });
    } else {
      modifications.push({ file, type: "delete" });
    }
  }

  const untracked = gitOut(session.workspace, ["ls-files", "--others", "--exclude-standard"]).split("\n").map((line) => line.trim()).filter(Boolean);
  for (const file of untracked) {
    const absolute = join(session.workspace, file);
    if (existsSync(absolute)) modifications.push({ file, type: "create", content: readFileSync(absolute, "utf-8") });
  }
  return modifications;
}

export function closeNativeEditSession(session: NativeEditSession): void {
  if (session.closed) return;
  session.closed = true;
  try { gitOut(session.sourceRoot, ["worktree", "remove", "--force", session.workspace]); } catch {}
  try { gitOut(session.sourceRoot, ["worktree", "prune"]); } catch {}
  rmSync(session.tempRoot, { recursive: true, force: true });
}

// Kept for internal compatibility, but deliberately non-destructive: direct
// capture of the user's checkout is no longer supported.
export function captureAndRevert(_root: string): CodeModification[] {
  throw new Error("Direct checkout capture is disabled; use an isolated native edit session");
}
