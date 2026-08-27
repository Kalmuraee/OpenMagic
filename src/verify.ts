
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeRoots, resolveProjectPath } from "./root-resolver.js";

export interface VerifyResult {
  status: "passed" | "failed" | "inconclusive";
  ran: string[];
  errors: string[];
  reason?: string;
}

const VERIFY_SCRIPTS = ["typecheck", "type-check", "tsc", "lint", "check"];

export function detectVerifyScripts(root: string): string[] {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return [];
  try {
    const scripts = JSON.parse(readFileSync(pkgPath, "utf-8"))?.scripts || {};
    return VERIFY_SCRIPTS.filter((name) => typeof scripts[name] === "string");
  } catch {
    return [];
  }
}

export function detectVerifyScript(root: string): { script: string } | null {
  const first = detectVerifyScripts(root)[0];
  return first ? { script: first } : null;
}

export function attributeToTouched(output: string, files: string[]): boolean {
  const haystack = output.toLowerCase();
  return files.some((file) => {
    const full = file.toLowerCase().replace(/\\/g, "/");
    const base = basename(file).toLowerCase();
    return haystack.includes(full) || (base.length > 2 && haystack.includes(base));
  });
}

export function verifyTouchedFiles(root: string, files: string[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const path = join(root, file);
    if (!existsSync(path)) continue;
    try { JSON.parse(readFileSync(path, "utf-8")); }
    catch (error) { errors.push(`${file}: invalid JSON after edit — ${(error as Error).message}`); }
  }
  return { ok: errors.length === 0, errors };
}

export interface RunScriptResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

export function runVerifyScript(root: string, script: string, timeoutMs: number, signal?: AbortSignal): Promise<RunScriptResult> {
  return new Promise((resolve) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", "--silent", script], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      detached: process.platform !== "win32",
    });
    let output = "";
    let settled = false;
    const cap = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 64_000) output = output.slice(-64_000);
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
    const timer = setTimeout(() => {
      killTree(child);
      finish({ code: null, output, timedOut: true, aborted: false });
    }, timeoutMs);
    const onAbort = () => {
      killTree(child);
      finish({ code: null, output, timedOut: false, aborted: true });
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", (error) => finish({ code: null, output, timedOut: false, aborted: false, spawnError: error.message }));
    child.on("close", (code) => finish({ code, output, timedOut: false, aborted: false }));
  });
}

export async function verifyPatchGroup(
  rootsInput: string | string[],
  opts: { files: string[]; timeoutMs?: number; signal?: AbortSignal }
): Promise<VerifyResult> {
  const roots = normalizeRoots(rootsInput);
  const grouped = new Map<string, string[]>();
  for (const file of opts.files) {
    const resolved = resolveProjectPath(file, roots, { mustExist: false });
    if ("error" in resolved) continue;
    const list = grouped.get(resolved.root) || [];
    list.push(resolved.relativePath);
    grouped.set(resolved.root, list);
  }

  const ran: string[] = [];
  const inconclusive: string[] = [];
  let configured = 0;
  for (const [root, files] of grouped) {
    const label = roots.length > 1 ? basename(root) : "";
    const json = verifyTouchedFiles(root, files);
    ran.push(label ? `${label}:json-parse` : "json-parse");
    if (!json.ok) return { status: "failed", ran, errors: json.errors };

    const scripts = detectVerifyScripts(root);
    configured += scripts.length;
    for (const script of scripts) {
      const result = await runVerifyScript(root, script, opts.timeoutMs ?? 20_000, opts.signal);
      ran.push(label ? `${label}:${script}` : script);
      if (result.aborted) return { status: "inconclusive", ran, errors: [], reason: "verification cancelled" };
      if (result.timedOut) {
        return { status: "failed", ran, errors: [`${script} timed out after ${opts.timeoutMs ?? 20_000}ms`] };
      }
      if (result.spawnError || result.code === null) {
        return { status: "failed", ran, errors: [`${script} could not run: ${result.spawnError || "unknown process error"}`] };
      }
      if (result.code !== 0) {
        if (attributeToTouched(result.output, files)) return { status: "failed", ran, errors: [trimErrors(result.output)] };
        inconclusive.push(`${script} failed only in files outside this edit (likely pre-existing)`);
      }
    }
  }

  if (configured === 0) return { status: "inconclusive", ran, errors: [], reason: "no typecheck/lint/check script in package.json" };
  if (inconclusive.length) return { status: "inconclusive", ran, errors: [], reason: inconclusive.join("; ") };
  return { status: "passed", ran, errors: [] };
}

function trimErrors(output: string): string {
  return output.split("\n").filter((line) => line.trim()).slice(-40).join("\n").slice(0, 4000);
}
