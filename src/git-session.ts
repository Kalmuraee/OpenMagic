import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, relative } from "node:path";

/**
 * Hosted-mode git session.
 *
 * When a host (MZJ Studio) embeds OpenMagic, every applied change must land on
 * a dedicated branch as a commit so the host can diff, review and submit it
 * later. `--git-mode branch --branch <name>` enables this: the branch is
 * created at startup and each successful write/delete/patch commits the paths
 * it touched. `--journal <path>` additionally appends a JSONL record per
 * commit so the host can reconstruct what happened without scraping git.
 *
 * Everything here is best-effort after startup: a commit that fails (nothing
 * staged, detached HEAD, etc.) is logged to the journal and swallowed, because
 * the write itself already succeeded and refusing the write would strand the
 * toolbar. Branch creation at startup is the exception — it throws, because
 * silently editing the wrong branch is worse than not starting.
 */

export interface GitSessionOptions {
  mode: "off" | "branch";
  branch?: string;
  journalPath?: string;
  /** Project root the git commands run in (the checkout root). */
  root: string;
}

interface JournalEntry {
  ts: string;
  event: string;
  branch?: string;
  paths?: string[];
  commit?: string;
  detail?: string;
}

export class GitSession {
  private readonly root: string;
  private readonly branch: string;
  private readonly journalPath?: string;

  constructor(opts: GitSessionOptions) {
    this.root = opts.root;
    this.branch = opts.branch || "";
    this.journalPath = opts.journalPath;
  }

  static isEnabled(opts: GitSessionOptions | undefined): opts is GitSessionOptions & { mode: "branch" } {
    return !!opts && opts.mode === "branch";
  }

  /** Create (or re-attach to) the session branch. Throws on failure. */
  start(): void {
    if (!this.branch) throw new Error("--git-mode branch requires --branch <name>");
    this.git(["rev-parse", "--is-inside-work-tree"]); // throws if not a repo
    try {
      this.git(["switch", "--quiet", this.branch]);
    } catch {
      this.git(["switch", "--quiet", "-c", this.branch]);
    }
    this.journal({ ts: now(), event: "session.start", branch: this.branch });
  }

  /** Commit the given absolute paths after a toolbar-applied change. */
  recordChange(kind: "write" | "delete" | "patch" | "undo", absPaths: string[], detail?: string): void {
    const rel = absPaths
      .map((p) => relative(this.root, p))
      .filter((p) => p && !p.startsWith("..") && !p.startsWith("/"));
    if (rel.length === 0) return;
    try {
      this.git(["add", "-A", "--", ...rel]);
      // Skip empty commits (e.g. an undo that restores the committed state).
      if (!this.git(["diff", "--cached", "--name-only"]).trim()) {
        this.journal({ ts: now(), event: `change.${kind}`, branch: this.branch, paths: rel, detail: "no staged changes" });
        return;
      }
      this.git([
        "-c", "user.name=OpenMagic",
        "-c", "user.email=openmagic@localhost",
        "commit", "--quiet", "--message", commitMessage(kind, rel),
      ]);
      const commit = this.git(["rev-parse", "HEAD"]).trim();
      this.journal({ ts: now(), event: `change.${kind}`, branch: this.branch, paths: rel, commit, detail });
    } catch (err) {
      this.journal({
        ts: now(), event: `change.${kind}`, branch: this.branch, paths: rel,
        detail: `commit failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      });
    }
  }

  stop(): void {
    this.journal({ ts: now(), event: "session.stop", branch: this.branch });
  }

  private git(args: string[]): string {
    return execFileSync("git", args, { cwd: this.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }

  private journal(entry: JournalEntry): void {
    if (!this.journalPath) return;
    try {
      mkdirSync(dirname(this.journalPath), { recursive: true });
      appendFileSync(this.journalPath, JSON.stringify(entry) + "\n");
    } catch {
      // Journaling is observability, never a reason to fail a write.
    }
  }
}

function now(): string {
  return new Date().toISOString();
}

function commitMessage(kind: string, rel: string[]): string {
  const names = rel.map((p) => basename(p));
  const shown = names.slice(0, 3).join(", ");
  const suffix = rel.length > 3 ? ` +${rel.length - 3} more` : "";
  const verb = kind === "delete" ? "delete" : kind === "patch" ? "apply patch to" : kind === "undo" ? "undo" : "update";
  return `openmagic: ${verb} ${shown}${suffix}`;
}