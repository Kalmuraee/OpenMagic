from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"{path}: required source fragment was not found")
    write(path, text.replace(old, new, 1))


def regex_replace(path: str, pattern: str, replacement: str, expected: int) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE | re.DOTALL)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} regex replacement(s), found {count}")
    write(path, updated)


Path("src/path-utils.ts").write_text(
    '''/** Convert repository-relative paths to a stable, cross-platform form. */
export function toPortablePath(value: string): string {
  return value.replace(/\\\\/g, "/");
}
''',
    encoding="utf-8",
)

# Repository-relative paths are part of OpenMagic's protocol and must use '/'
# on every operating system.
replace_once(
    "src/filesystem.ts",
    'import type { FileEntry } from "./shared-types.js";\n',
    'import type { FileEntry } from "./shared-types.js";\nimport { toPortablePath } from "./path-utils.js";\n',
)
replace_once(
    "src/filesystem.ts",
    "      const relPath = relative(rootPath, fullPath);",
    "      const relPath = toPortablePath(relative(rootPath, fullPath));",
)
replace_once(
    "src/filesystem.ts",
    "                file: relative(searchRoot, fullPath),",
    "                file: toPortablePath(relative(searchRoot, fullPath)),",
)

replace_once(
    "src/project-grounding.ts",
    'import { listFiles, readFileSafe } from "./filesystem.js";\n',
    'import { listFiles, readFileSafe } from "./filesystem.js";\nimport { toPortablePath } from "./path-utils.js";\n',
)
replace_once(
    "src/project-grounding.ts",
    "      base = relative(root, join(root, dir, imp));",
    "      base = toPortablePath(relative(root, join(root, dir, imp)));",
)
regex_replace(
    "src/project-grounding.ts",
    r'''      const marker = `\\n// \[TRUNCATED \$\{read\.content\.length\} chars — request the rest with NEED_FILE: \$\{item\.path\}\]`;
      const room = Math\.max\(0, cap - marker\.length\);
      content = read\.content\.slice\(0, room\) \+ marker;''',
    '''      const verboseMarker = `\\n// [TRUNCATED ${read.content.length} chars — request the rest with NEED_FILE: ${item.path}]`;
      const compactMarker = `\\n// [TRUNCATED — NEED_FILE: ${item.path}]`;
      const marker = verboseMarker.length <= cap ? verboseMarker : compactMarker.slice(0, cap);
      const room = Math.max(0, cap - marker.length);
      content = read.content.slice(0, room) + marker;''',
    1,
)

replace_once(
    "src/root-resolver.ts",
    'import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";\n',
    'import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";\nimport { toPortablePath } from "./path-utils.js";\n',
)
regex_replace(
    "src/root-resolver.ts",
    r"const relativePath = relative\(([^;]+)\);",
    r"const relativePath = toPortablePath(relative(\1));",
    4,
)

# Windows cannot reliably execute npm.cmd directly through spawn() on all Node
# runner combinations. Invoke it through ComSpec and reject shell metacharacters.
replace_once(
    "src/verify.ts",
    "  const haystack = output.toLowerCase();",
    '  const haystack = output.toLowerCase().replace(/\\\\/g, "/");',
)
regex_replace(
    "src/verify.ts",
    r'''export function runVerifyScript\(root: string, script: string, timeoutMs: number, signal\?: AbortSignal\): Promise<RunScriptResult> \{
  return new Promise\(\(resolve\) => \{
    const npm = process\.platform === "win32" \? "npm\.cmd" : "npm";
    const child = spawn\(npm, \["run", "--silent", script\], \{
      cwd: root,
      stdio: \["ignore", "pipe", "pipe"\],
      env: \{ \.\.\.process\.env, FORCE_COLOR: "0", NO_COLOR: "1" \},
      detached: process\.platform !== "win32",
    \}\);
    let output = "";''',
    '''export interface NpmInvocation {
  command: string;
  args: string[];
}

export function getNpmInvocation(
  script: string,
  platform: NodeJS.Platform = process.platform,
): NpmInvocation | { error: string } {
  if (!/^[A-Za-z0-9:_-]+$/.test(script)) return { error: "Invalid npm script name" };
  if (platform === "win32") {
    return {
      command: process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", `npm run --silent ${script}`],
    };
  }
  return { command: "npm", args: ["run", "--silent", script] };
}

export function runVerifyScript(root: string, script: string, timeoutMs: number, signal?: AbortSignal): Promise<RunScriptResult> {
  return new Promise((resolve) => {
    const invocation = getNpmInvocation(script);
    if ("error" in invocation) {
      resolve({ code: null, output: "", timedOut: false, aborted: false, spawnError: invocation.error });
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        output: "",
        timedOut: false,
        aborted: false,
        spawnError: (error as Error).message,
      });
      return;
    }
    let output = "";''',
    1,
)

replace_once(
    "tests/verify.test.ts",
    "  runVerifyScript,\n  verifyPatchGroup,",
    "  runVerifyScript,\n  getNpmInvocation,\n  verifyPatchGroup,",
)
replace_once(
    "tests/verify.test.ts",
    'describe("runVerifyScript", () => {',
    '''describe("getNpmInvocation", () => {
  it("uses cmd.exe without spawning a .cmd file directly on Windows", () => {
    const invocation = getNpmInvocation("typecheck", "win32");
    expect("error" in invocation).toBe(false);
    if ("error" in invocation) return;
    expect(invocation.command.toLowerCase()).toContain("cmd");
    expect(invocation.args).toEqual(["/d", "/s", "/c", "npm run --silent typecheck"]);
  });

  it("rejects unsafe script names before invoking a shell", () => {
    expect(getNpmInvocation("lint && whoami", "win32")).toEqual({ error: "Invalid npm script name" });
  });
});

describe("runVerifyScript", () => {''',
)

Path("tests/path-utils.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";
import { toPortablePath } from "../src/path-utils.js";

describe("toPortablePath", () => {
  it("normalizes Windows repository paths", () => {
    expect(toPortablePath("src\\\\components\\\\Hero.tsx")).toBe("src/components/Hero.tsx");
  });

  it("leaves portable paths unchanged", () => {
    expect(toPortablePath("src/components/Hero.tsx")).toBe("src/components/Hero.tsx");
  });
});
''',
    encoding="utf-8",
)

print("Windows CI remediation applied")
