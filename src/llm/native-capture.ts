import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeModification } from "../shared-types.js";

/**
 * H9: capture a CLI agent's native edits via git, then REVERT the working tree.
 *
 * CLI agents (Claude Code / Codex / Gemini) are full edit-capable harnesses. The
 * old path forced them through the JSON-diff contract and re-applied with a lossy
 * fuzzy matcher (a double-apply). Here we instead let them edit the tree natively,
 * diff the result against the clean baseline, revert, and route the diff through
 * the normal review→apply→verify pipeline. This reclaims their multi-turn ability
 * WITHOUT the write-before-approve security regression — files are reverted before
 * the user reviews. Off by default; requires a git repo with a clean tree.
 */

function gitOut(root: string, args: string[]): string {
  return execSync(`git ${args.join(" ")}`, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function isGitRepo(root: string): boolean {
  try {
    return gitOut(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

export function isWorkingTreeClean(root: string): boolean {
  try {
    return gitOut(root, ["status", "--porcelain"]).trim() === "";
  } catch {
    return false;
  }
}

/**
 * Eligible only when native edits can be cleanly attributed and reverted: a git
 * repo whose working tree is clean (so every post-agent change is the agent's).
 */
export function isNativeEditEligible(root: string): boolean {
  return isGitRepo(root) && isWorkingTreeClean(root);
}

/**
 * Collect the agent's changes as CodeModifications (whole-file edits / creates)
 * then reset the tree back to the clean baseline.
 */
export function captureAndRevert(root: string): CodeModification[] {
  const mods: CodeModification[] = [];

  try {
    // Tracked files changed vs HEAD (staged or unstaged).
    const changed = gitOut(root, ["diff", "HEAD", "--name-only"]).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const file of changed) {
      let before = "";
      try { before = gitOut(root, ["show", `HEAD:${file}`]); } catch { before = ""; }
      const abs = join(root, file);
      if (existsSync(abs)) {
        const after = readFileSync(abs, "utf-8");
        if (after !== before) mods.push({ file, type: "edit", search: before, replace: after });
      } else {
        // tracked file the agent deleted
        mods.push({ file, type: "delete" });
      }
    }

    // New untracked files.
    const untracked = gitOut(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const file of untracked) {
      const abs = join(root, file);
      if (existsSync(abs)) {
        mods.push({ file, type: "create", content: readFileSync(abs, "utf-8") });
      }
    }
  } catch {
    // capture failed — fall through to revert so we never leave the tree dirty
  }

  // Revert to the clean baseline (tracked + untracked) so the user reviews from
  // a known state and the proposed edits apply through the normal pipeline.
  try { gitOut(root, ["reset", "--hard", "HEAD"]); } catch { /* best effort */ }
  try { gitOut(root, ["clean", "-fd"]); } catch { /* best effort */ }

  return mods;
}
