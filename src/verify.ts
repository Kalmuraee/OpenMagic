import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Post-apply verification. This is the gate that closes OpenMagic's open loop:
 * after an edit is written, confirm it didn't break the build before declaring
 * success — and if it did, feed the errors back for a bounded self-correction.
 *
 * Cheapest-first:
 *   1. re-parse touched JSON files (free, deterministic),
 *   2. run the project's own typecheck/lint npm script if one exists
 *      (capability-probed, cancellable, timeout-capped),
 *   3. attribute failures to the edit (output must mention a touched file) so we
 *      don't self-correct on pre-existing project errors.
 */

export interface VerifyResult {
  status: "passed" | "failed" | "inconclusive";
  ran: string[];
  errors: string[];
  reason?: string;
}

// npm script names we treat as a verification gate, best first.
const VERIFY_SCRIPTS = ["typecheck", "type-check", "tsc", "lint", "check"];

export function detectVerifyScript(root: string): { script: string } | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    scripts = pkg.scripts || {};
  } catch {
    return null;
  }
  for (const name of VERIFY_SCRIPTS) {
    if (typeof scripts[name] === "string") return { script: name };
  }
  return null;
}

/** True if the script output mentions any of the touched files (full path or basename). */
export function attributeToTouched(output: string, files: string[]): boolean {
  const haystack = output.toLowerCase();
  return files.some((f) => {
    const full = f.toLowerCase();
    const base = basename(f).toLowerCase();
    return haystack.includes(full) || (base.length > 2 && haystack.includes(base));
  });
}

/** Re-parse touched JSON files; non-JSON files are left to the script tier. */
export function verifyTouchedFiles(root: string, files: string[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const path = join(root, file);
    if (!existsSync(path)) continue;
    try {
      JSON.parse(readFileSync(path, "utf-8"));
    } catch (e) {
      errors.push(`${file}: invalid JSON after edit — ${(e as Error).message}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export interface RunScriptResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
}

// `npm run <script>` spawns the actual command as a grandchild; killing only the
// npm wrapper leaves it (and its stdio pipes) alive, so 'close' never fires. Kill
// the whole tree: the process group on POSIX, taskkill /T on Windows.
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL"); // negative pid = process group (requires detached)
    }
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

export function runVerifyScript(
  root: string,
  script: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<RunScriptResult> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "--silent", script], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      detached: process.platform !== "win32", // own process group so killTree reaches grandchildren
    });

    let output = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const cap = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 64_000) output = output.slice(-64_000); // keep the tail (errors land last)
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);

    const finish = (result: RunScriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    // On timeout/abort, kill the tree and resolve immediately — don't wait for
    // 'close', which can lag while a killed grandchild's pipes drain.
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      finish({ code: null, output, timedOut: true, aborted });
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      killTree(child);
      finish({ code: null, output, timedOut, aborted: true });
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", () => finish({ code: null, output: output || "failed to spawn npm", timedOut, aborted }));
    child.on("close", (code) => finish({ code, output, timedOut, aborted }));
  });
}

export async function verifyPatchGroup(
  root: string,
  opts: { files: string[]; timeoutMs?: number; signal?: AbortSignal }
): Promise<VerifyResult> {
  const ran: string[] = [];

  // 1. Cheap, deterministic: touched JSON must still parse.
  const json = verifyTouchedFiles(root, opts.files);
  ran.push("json-parse");
  if (!json.ok) {
    return { status: "failed", ran, errors: json.errors };
  }

  // 2. The project's own typecheck/lint, if it has one.
  const detected = detectVerifyScript(root);
  if (!detected) {
    return { status: "inconclusive", ran, errors: [], reason: "no typecheck/lint script in package.json" };
  }

  const result = await runVerifyScript(root, detected.script, opts.timeoutMs ?? 20_000, opts.signal);
  ran.push(detected.script);

  if (result.aborted) {
    return { status: "inconclusive", ran, errors: [], reason: "verification cancelled" };
  }
  if (result.timedOut) {
    return { status: "inconclusive", ran, errors: [], reason: `verification timed out after ${opts.timeoutMs ?? 20_000}ms` };
  }
  if (result.code === 0) {
    return { status: "passed", ran, errors: [] };
  }

  // 3. Failing script — only blame the edit if the output references a touched file,
  // otherwise the errors are pre-existing and self-correcting would be wrong.
  if (attributeToTouched(result.output, opts.files)) {
    return { status: "failed", ran, errors: [trimErrors(result.output)] };
  }
  return {
    status: "inconclusive",
    ran,
    errors: [],
    reason: "verify script failed but the errors are not in the edited files (likely pre-existing)",
  };
}

function trimErrors(output: string): string {
  const lines = output.split("\n").filter((l) => l.trim());
  return lines.slice(-40).join("\n").slice(0, 4000);
}
