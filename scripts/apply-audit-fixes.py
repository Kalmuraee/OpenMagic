from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def get(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def put(path: str, text: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def replace(path: str, old: str, new: str, count: int = 1, optional: bool = False) -> None:
    text = get(path)
    found = text.count(old)
    if found == 0 and optional:
        return
    if found < count:
        raise RuntimeError(f"{path}: missing replacement target: {old[:120]!r}")
    put(path, text.replace(old, new, count))


def sub(path: str, pattern: str, replacement: str, count: int = 1, flags: int = 0, optional: bool = False) -> None:
    text = get(path)
    out, n = re.subn(pattern, replacement, text, count=count, flags=flags)
    if n != count and not optional:
        raise RuntimeError(f"{path}: regex target count {n}, expected {count}: {pattern[:120]}")
    if n:
        put(path, out)


def block(text: str, anchor: str) -> tuple[int, int]:
    start = text.find(anchor)
    if start < 0:
        raise RuntimeError(f"anchor not found: {anchor}")
    opening = text.find("{", start)
    if opening < 0:
        raise RuntimeError(f"opening brace not found: {anchor}")
    depth = 0
    quote = None
    escaped = False
    for i in range(opening, len(text)):
        ch = text[i]
        if escaped:
            escaped = False
            continue
        if quote:
            if ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch in "'\"`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return start, i + 1
    raise RuntimeError(f"unterminated block: {anchor}")


def replace_block(path: str, anchor: str, new: str) -> None:
    text = get(path)
    start, end = block(text, anchor)
    put(path, text[:start] + new + text[end:])


# Already applied by an earlier guarded run.
if (ROOT / "src/root-resolution.ts").exists() and "resolveProviderApiKey" in get("src/config.ts"):
    print("audit fixes already present")
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# Credential isolation
# ---------------------------------------------------------------------------
replace(
    "src/config.ts",
    '    const raw = readFileSync(CONFIG_FILE, "utf-8");\n    return JSON.parse(raw);',
    '''    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OpenMagicConfig>;
    if (parsed.apiKey && parsed.provider && !parsed.apiKeys?.[parsed.provider]) {
      parsed.apiKeys = { ...(parsed.apiKeys || {}), [parsed.provider]: parsed.apiKey };
    }
    return parsed;''',
)
replace(
    "src/config.ts",
    '    const merged = { ...existing, ...updates };\n    const tmpFile = CONFIG_FILE + ".tmp";',
    '''    const merged = { ...existing, ...updates };
    if (merged.provider && merged.apiKeys?.[merged.provider]) delete merged.apiKey;
    const tmpFile = CONFIG_FILE + ".tmp";''',
)
replace(
    "src/config.ts",
    "\nexport function getConfigPath(): string {",
    '''

export function resolveProviderApiKey(config: Partial<OpenMagicConfig>, provider: string): string {
  if (!provider) return "";
  const scoped = config.apiKeys?.[provider];
  if (scoped) return scoped;
  return config.provider === provider ? (config.apiKey || "") : "";
}

export function getConfigPath(): string {''',
)

# ---------------------------------------------------------------------------
# Root-aware path selection
# ---------------------------------------------------------------------------
put(
    "src/root-resolution.ts",
    '''import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export interface ResolvedProjectPath { root: string; path: string; relativePath: string }

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function rootsOf(input: string[]): string[] {
  return [...new Set(input.map((root) => {
    try { return realpathSync(resolve(root)); } catch { return resolve(root); }
  }))];
}

export function resolveProjectPath(
  input: string[], requested: string,
  options: { allowCreate?: boolean; requireExisting?: boolean } = {}
): ResolvedProjectPath | { error: string } {
  const roots = rootsOf(input);
  if (!roots.length) return { error: "No project roots configured" };
  if (!requested || requested.includes("\\0")) return { error: "Invalid path" };

  if (isAbsolute(requested)) {
    const candidate = resolve(requested);
    const matches = roots.filter((root) => inside(root, candidate));
    if (matches.length !== 1) return { error: "Path is outside configured project roots" };
    if (options.requireExisting && !existsSync(candidate)) return { error: "File not found" };
    return { root: matches[0], path: candidate, relativePath: relative(matches[0], candidate) };
  }

  const normalized = requested.replace(/\\\\/g, "/");
  for (const root of roots) {
    const prefix = `${basename(root)}/`;
    if (!normalized.startsWith(prefix)) continue;
    const rel = normalized.slice(prefix.length);
    const candidate = resolve(root, rel);
    if (!inside(root, candidate)) return { error: "Path is outside configured project root" };
    if (options.requireExisting && !existsSync(candidate)) return { error: "File not found" };
    return { root, path: candidate, relativePath: rel };
  }

  const existing = roots.map((root) => ({ root, path: resolve(root, requested) }))
    .filter((entry) => inside(entry.root, entry.path) && existsSync(entry.path));
  if (existing.length > 1) return { error: `Path is ambiguous across project roots: ${requested}` };
  if (existing.length === 1) return { ...existing[0], relativePath: relative(existing[0].root, existing[0].path) };
  if (options.requireExisting || !options.allowCreate) return { error: "File not found" };
  const candidate = resolve(roots[0], requested);
  if (!inside(roots[0], candidate)) return { error: "Path is outside configured project root" };
  return { root: roots[0], path: candidate, relativePath: relative(roots[0], candidate) };
}

export function displayProjectPath(root: string, rel: string, roots: string[]): string {
  const normalized = rel.replace(/\\\\/g, "/");
  return roots.length > 1 ? `${basename(root)}/${normalized}` : normalized;
}
''',
)

# ---------------------------------------------------------------------------
# Exact, permission-preserving file operations
# ---------------------------------------------------------------------------
replace("src/filesystem.ts", "  writeSync,\n} from \"node:fs\";", "  writeSync,\n  chmodSync,\n  mkdtempSync,\n} from \"node:fs\";")
replace(
    "src/filesystem.ts",
    'const BACKUP_DIR = join(tmpdir(), "openmagic-backups");',
    '''let backupDir: string | null = null;
function getBackupDir(): string {
  if (!backupDir) {
    backupDir = mkdtempSync(join(tmpdir(), "openmagic-backups-"));
    try { chmodSync(backupDir, 0o700); } catch {}
  }
  return backupDir;
}''',
)
replace("src/filesystem.ts", "return join(BACKUP_DIR, `${hash}_${unique}_${name}`);", "return join(getBackupDir(), `${hash}_${unique}_${name}`);")
replace(
    "src/filesystem.ts",
    '''    if (existsSync(BACKUP_DIR)) {
      rmSync(BACKUP_DIR, { recursive: true, force: true });
    }''',
    '''    if (backupDir && existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }''',
)
replace("src/filesystem.ts", "  backupStack.clear();\n}", "  backupStack.clear();\n  backupDir = null;\n}", 1)
replace("src/filesystem.ts", "if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });", "const backupRoot = getBackupDir();\n  if (!existsSync(backupRoot)) mkdirSync(backupRoot, { recursive: true, mode: 0o700 });")
replace_block(
    "src/filesystem.ts",
    "function atomicWriteFile(",
    '''function atomicWriteFile(filePath: string, data: string | Buffer, requestedMode?: number): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) throw new Error("Refusing to replace a symbolic link");
  const existingMode = existsSync(filePath) ? (statSync(filePath).mode & 0o7777) : undefined;
  const mode = requestedMode ?? existingMode ?? 0o644;
  const tmpPath = join(dir, `.${parse(filePath).base}.openmagic-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let fd: number | undefined;
  try {
    fd = openSync(tmpPath, "w", mode);
    if (Buffer.isBuffer(data)) writeSync(fd, data);
    else writeSync(fd, data, 0, "utf-8");
    try { chmodSync(tmpPath, mode); } catch {}
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(tmpPath, filePath);
    fsyncDir(dir);
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    try { unlinkSync(tmpPath); } catch {}
    throw error;
  }
}''',
)
replace(
    "src/filesystem.ts",
    '''  try {
    const backupPath = pushBackup(filePath, createBackupEntry(filePath));''',
    '''  try {
    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
      return { ok: false, error: "Refusing to edit a symbolic link" };
    }
    const backupPath = pushBackup(filePath, createBackupEntry(filePath));''',
    1,
)
replace(
    "src/filesystem.ts",
    "\nexport function deleteFileSafe(",
    '''

export function restoreFileExact(filePath: string, data: Buffer, roots: string[], mode?: number): { ok: boolean; error?: string } {
  if (!isPathSafe(filePath, roots)) return { ok: false, error: "Path is outside allowed roots" };
  try {
    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) return { ok: false, error: "Refusing to replace a symbolic link" };
    atomicWriteFile(filePath, data, mode);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Failed to restore file: ${(e as Error).message}` };
  }
}

export function deleteFileSafe(''',
)
replace(
    "src/filesystem.ts",
    '  ".json", ".md", ".yaml", ".yml",\n  ".php", ".py", ".rb",',
    '  ".json", ".md", ".mdx", ".yaml", ".yml", ".graphql", ".gql", ".prisma", ".sql",\n  ".php", ".py", ".rb", ".go", ".java", ".cs", ".rs", ".twig", ".erb",',
)

# ---------------------------------------------------------------------------
# Durable patch manifests and multi-root patching
# ---------------------------------------------------------------------------
replace("src/patch.ts", 'import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";', 'import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";')
replace("src/patch.ts", 'import { deleteFileSafe, isPathSafe, readFileSafe, writeFileSafe } from "./filesystem.js";', 'import { deleteFileSafe, isPathSafe, readFileSafe, restoreFileExact, writeFileSafe } from "./filesystem.js";\nimport { resolveProjectPath } from "./root-resolution.js";')
replace("src/patch.ts", "interface PlannedPatch {\n  patch: FilePatch;\n  path: string;", "interface PlannedPatch {\n  patch: FilePatch;\n  root: string;\n  path: string;")
replace(
    "src/patch.ts",
    '''  files: Array<{
    path: string;
    existed: boolean;
    content: string;
  }>;''',
    '''  files: Array<{
    path: string;
    existed: boolean;
    contentBase64?: string;
    content?: string;
    mode?: number;
  }>;''',
)
replace("src/patch.ts", "mkdirSync(manifestDir(), { recursive: true });", "mkdirSync(manifestDir(), { recursive: true, mode: 0o700 });\n    try { chmodSync(manifestDir(), 0o700); } catch {}", 1)
replace("src/patch.ts", 'writeFileSync(tmp, JSON.stringify(manifest), "utf-8");', 'writeFileSync(tmp, JSON.stringify(manifest), { encoding: "utf-8", mode: 0o600 });\n    try { chmodSync(tmp, 0o600); } catch {}', 1)
replace("src/patch.ts", "export function previewPatch(root: string, patch: FilePatch): PatchPreviewResult {\n  const planned = planPatches(root, [patch]);", "export function previewPatch(roots: string | string[], patch: FilePatch): PatchPreviewResult {\n  const planned = planPatches(roots, [patch]);")
replace("src/patch.ts", "export function previewPatchGroup(root: string, request: PatchGroupRequest): PatchPreviewResult {\n  const planned = planPatches(root, request.patches);", "export function previewPatchGroup(roots: string | string[], request: PatchGroupRequest): PatchPreviewResult {\n  const planned = planPatches(roots, request.patches);")
replace("src/patch.ts", "export function applyPatchGroup(root: string, request: PatchGroupRequest): PatchApplyResult {\n  const planned = planPatches(root, request.patches);", "export function applyPatchGroup(rootsInput: string | string[], request: PatchGroupRequest): PatchApplyResult {\n  const roots = Array.isArray(rootsInput) ? rootsInput : [rootsInput];\n  const planned = planPatches(roots, request.patches);")
replace(
    "src/patch.ts",
    '''    files: planned.map((item) => ({
      path: item.path,
      existed: item.existed,
      content: item.originalContent,
    })),''',
    '''    files: planned.map((item) => {
      const raw = item.existed ? readFileSync(item.path) : Buffer.alloc(0);
      return { path: item.path, existed: item.existed, contentBase64: raw.toString("base64"), mode: item.existed ? (statSync(item.path).mode & 0o7777) : undefined };
    }),''',
)
replace("src/patch.ts", "result = deleteFileSafe(item.path, [root]);", "result = deleteFileSafe(item.path, roots);")
replace("src/patch.ts", 'result = writeFileSafe(item.path, item.nextContent || "", [root]);', 'result = writeFileSafe(item.path, item.nextContent || "", roots);')
replace("src/patch.ts", "const rollback = rollbackApplied(root, applied);", "const rollback = rollbackApplied(roots, applied);")
replace("src/patch.ts", "export function rollbackPatchGroup(root: string, groupId: string):", "export function rollbackPatchGroup(rootsInput: string | string[], groupId: string):")
replace("src/patch.ts", "  const manifest = loadManifest(groupId);\n  if (!manifest)", "  const roots = Array.isArray(rootsInput) ? rootsInput : [rootsInput];\n  const manifest = loadManifest(groupId);\n  if (!manifest)", 1)
replace(
    "src/patch.ts",
    '''    if (file.existed) {
      const result = writeFileSafe(file.path, file.content, [root]);
      if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to restore ${file.path}` };
    } else if (existsSync(file.path)) {
      const result = deleteFileSafe(file.path, [root]);''',
    '''    if (file.existed) {
      const raw = file.contentBase64 !== undefined ? Buffer.from(file.contentBase64, "base64") : Buffer.from(file.content || "", "utf-8");
      const result = restoreFileExact(file.path, raw, roots, file.mode);
      if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to restore ${file.path}` };
    } else if (existsSync(file.path)) {
      const result = deleteFileSafe(file.path, roots);''',
)
replace_block(
    "src/patch.ts",
    "export function rollbackChain(",
    '''export function rollbackChain(roots: string | string[], groupId: string): { ok: boolean; error?: string; groupId: string; files?: string[] } {
  const visited = new Set<string>();
  const chain: string[] = [];
  let current: string | undefined = groupId;
  while (current) {
    if (visited.has(current)) return { ok: false, groupId, error: "Patch rollback chain contains a cycle" };
    visited.add(current);
    const manifest = loadManifest(current);
    if (!manifest) return { ok: false, groupId, error: `Patch manifest missing for ${current}; no files were changed` };
    chain.push(current);
    current = manifest.parentGroupId;
  }
  const files: string[] = [];
  for (const id of chain) {
    const rb = rollbackPatchGroup(roots, id);
    if (!rb.ok) return { ok: false, groupId, error: rb.error };
    if (rb.files) files.push(...rb.files);
  }
  return { ok: true, groupId, files: [...new Set(files)] };
}''',
)
replace("src/patch.ts", "function planPatches(root: string, patches: FilePatch[]): PlannedPatch[] {", "function planPatches(rootsInput: string | string[], patches: FilePatch[]): PlannedPatch[] {\n  const roots = Array.isArray(rootsInput) ? rootsInput : [rootsInput];")
replace(
    "src/patch.ts",
    '''  return patches.map((patch) => {
    const path = resolvePatchPath(root, patch.file);
    const base = loadBaseContent(root, path, stagedContent);
    const initialChange: PatchPreviewChange = { file: patch.file, type: patch.type, ok: false };

    if (!isPatchPathSafe(root, path)) {''',
    '''  return patches.map((patch) => {
    const target = resolveProjectPath(roots, patch.file, { allowCreate: patch.type === "create", requireExisting: patch.type !== "create" });
    const initialChange: PatchPreviewChange = { file: patch.file, type: patch.type, ok: false };
    if ("error" in target) {
      return { patch, root: roots[0] || process.cwd(), path: resolve(roots[0] || process.cwd(), patch.file), existed: false, originalContent: "", change: { ...initialChange, reason: target.error } };
    }
    const { root, path } = target;
    const base = loadBaseContent(roots, path, stagedContent);

    if (!isPatchPathSafe(roots, path)) {''',
)
# All ordinary planned-return objects now include their selected root.
text = get("src/patch.ts").replace("        patch,\n        path,", "        patch,\n        root,\n        path,").replace("      patch,\n      path,", "      patch,\n      root,\n      path,")
text = re.sub(r"\nfunction resolvePatchPath\([\s\S]*?\n}\n\nfunction isPatchPathSafe", "\nfunction isPatchPathSafe", text, count=1)
text = text.replace("function isPatchPathSafe(root: string, path: string): boolean {\n  return isPathSafe(path, [root]);", "function isPatchPathSafe(roots: string[], path: string): boolean {\n  return isPathSafe(path, roots);")
text = text.replace("function loadBaseContent(\n  root: string,", "function loadBaseContent(\n  roots: string[],")
text = text.replace("const read = readFileSafe(path, [root]);", "const read = readFileSafe(path, roots);")
text = text.replace("function rollbackApplied(root: string, applied: PlannedPatch[]):", "function rollbackApplied(roots: string[], applied: PlannedPatch[]):")
text = text.replace("writeFileSafe(item.path, item.originalContent, [root])", "writeFileSafe(item.path, item.originalContent, roots)")
text = text.replace("deleteFileSafe(item.path, [root])", "deleteFileSafe(item.path, roots)")
put("src/patch.ts", text)

# ---------------------------------------------------------------------------
# Verification: run every available project gate
# ---------------------------------------------------------------------------
replace_block(
    "src/verify.ts",
    "export function detectVerifyScript(",
    '''export function detectVerifyScripts(root: string): string[] {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts || {};
    return VERIFY_SCRIPTS.filter((name) => typeof scripts[name] === "string");
  } catch { return []; }
}

export function detectVerifyScript(root: string): { script: string } | null {
  const script = detectVerifyScripts(root)[0];
  return script ? { script } : null;
}''',
)
replace_block(
    "src/verify.ts",
    "export async function verifyPatchGroup(",
    '''export async function verifyPatchGroup(root: string, opts: { files: string[]; timeoutMs?: number; signal?: AbortSignal }): Promise<VerifyResult> {
  const ran: string[] = [];
  const json = verifyTouchedFiles(root, opts.files);
  ran.push("json-parse");
  if (!json.ok) return { status: "failed", ran, errors: json.errors };
  const scripts = detectVerifyScripts(root);
  if (!scripts.length) return { status: "inconclusive", ran, errors: [], reason: "no typecheck/lint script in package.json" };
  const inconclusive: string[] = [];
  for (const script of scripts) {
    const result = await runVerifyScript(root, script, opts.timeoutMs ?? 20_000, opts.signal);
    ran.push(script);
    if (result.aborted) return { status: "inconclusive", ran, errors: [], reason: "verification cancelled" };
    if (result.timedOut) { inconclusive.push(`${script} timed out`); continue; }
    if (result.code === 0) continue;
    if (attributeToTouched(result.output, opts.files)) return { status: "failed", ran, errors: [trimErrors(result.output)] };
    inconclusive.push(`${script} failed outside edited files`);
  }
  return inconclusive.length ? { status: "inconclusive", ran, errors: [], reason: inconclusive.join("; ") } : { status: "passed", ran, errors: [] };
}''',
)

# ---------------------------------------------------------------------------
# Proxy correctness
# ---------------------------------------------------------------------------
replace("src/proxy.ts", "    if (!isHtml && status < 400) {", "    if (!isHtml) {")
replace(
    "src/proxy.ts",
    '''    if (isHtml) {
      // HTML response: stream through and append toolbar script''',
    '''    if (isHtml) {
      const encoding = String(proxyRes.headers["content-encoding"] || "").toLowerCase();
      if (encoding && encoding !== "identity") {
        res.writeHead(status, proxyRes.headers);
        proxyRes.on("error", () => { try { res.end(); } catch {} });
        proxyRes.pipe(res);
        return;
      }
      // HTML response: stream through and append toolbar script''',
)

# ---------------------------------------------------------------------------
# Provider images / Gemini thinking / complete streams
# ---------------------------------------------------------------------------
replace("src/shared-types.ts", "  screenshot?: string; // base64 data URL", "  screenshot?: string; // base64 data URL\n  attachments?: string[]; // additional base64 image data URLs")
replace("src/shared-types.ts", "  nativeEdit?: boolean;             // H9: CLI agent edits files directly (plain prompt, no JSON contract)", "  nativeEdit?: boolean;             // H9: CLI agent edits files in an isolated worktree\n  executionRoot?: string;           // server-only cwd for local CLI adapters")
replace(
    "src/llm/google.ts",
    '''      if (context.screenshot) {
        const mimeMatch = context.screenshot.match(/^data:(image\/[a-z+]+);base64,/);
        const mimeType = mimeMatch?.[1] || "image/png";
        const base64Data = context.screenshot.replace(/^data:image\/[a-z+]+;base64,/, "");
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64Data,
          },
        });
      }''',
    '''      const images = [...new Set([context.screenshot, ...(context.attachments || [])].filter((value): value is string => !!value))];
      for (const image of images) {
        const match = image.match(/^data:(image\/[-+.\w]+);base64,([\s\S]*)$/);
        if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      }''',
)
replace(
    "src/llm/google.ts",
    '''  if (thinkingLevel) {
    body.thinkingConfig = { thinkingLevel };
  }''',
    '''  if (thinkingLevel && model.startsWith("gemini-3")) {
    generationConfig.thinkingConfig = { thinkingLevel };
  } else if (modelInfo?.thinking?.paramType === "budget") {
    const budget = context.thinkingBudget ?? modelInfo.thinking.defaultBudget;
    if (budget !== undefined) generationConfig.thinkingConfig = { thinkingBudget: budget };
  }''',
)
# Process a final non-newline-terminated SSE event using the existing parser loop.
for stream_path in ("src/llm/openai.ts", "src/llm/anthropic.ts"):
    text = get(stream_path)
    target = '''      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });'''
    if target in text:
        text = text.replace(target, '''      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer && !buffer.endsWith("\\n")) buffer += "\\n";
      } else {
        buffer += decoder.decode(value, { stream: true });
      }''', 1)
        start, end = block(text, "    while (true) {")
        text = text[:end - 1] + "\n      if (done) break;\n    " + text[end - 1:]
        put(stream_path, text)

# ---------------------------------------------------------------------------
# Safe native CLI lifecycle
# ---------------------------------------------------------------------------
put(
    "src/llm/native-capture.ts",
    '''import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CodeModification } from "../shared-types.js";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
}
export function isGitRepo(root: string): boolean { try { return git(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true"; } catch { return false; } }
export function isWorkingTreeClean(root: string): boolean { try { return git(root, ["status", "--porcelain", "--untracked-files=all"]).trim() === ""; } catch { return false; } }
export function isNativeEditEligible(root: string): boolean { return isGitRepo(root) && isWorkingTreeClean(root); }
export interface NativeEditSession { sourceRoot: string; worktree: string }
export function prepareNativeEditSession(root: string): NativeEditSession {
  if (!isNativeEditEligible(root)) throw new Error("Native edit requires a clean Git working tree");
  const worktree = mkdtempSync(join(tmpdir(), "openmagic-native-edit-"));
  rmSync(worktree, { recursive: true, force: true });
  git(root, ["worktree", "add", "--detach", worktree, "HEAD"]);
  const sourceModules = join(root, "node_modules"), targetModules = join(worktree, "node_modules");
  if (existsSync(sourceModules) && !existsSync(targetModules)) {
    try { symlinkSync(sourceModules, targetModules, process.platform === "win32" ? "junction" : "dir"); } catch {}
  }
  return { sourceRoot: root, worktree };
}
export function captureNativeEditSession(session: NativeEditSession): CodeModification[] {
  const root = session.worktree, mods: CodeModification[] = [];
  for (const file of git(root, ["diff", "HEAD", "--name-only", "-z"]).split("\\0").filter(Boolean)) {
    let before = ""; try { before = git(root, ["show", `HEAD:${file}`]); } catch {}
    const abs = join(root, file);
    if (existsSync(abs) && !lstatSync(abs).isSymbolicLink()) {
      const after = readFileSync(abs, "utf-8");
      if (after !== before) mods.push({ file, type: "edit", search: before, replace: after });
    } else if (!existsSync(abs)) mods.push({ file, type: "delete" });
  }
  for (const file of git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\\0").filter(Boolean)) {
    const abs = join(root, file);
    if (existsSync(abs) && !lstatSync(abs).isSymbolicLink()) mods.push({ file, type: "create", content: readFileSync(abs, "utf-8") });
  }
  return mods;
}
export function disposeNativeEditSession(session: NativeEditSession): void {
  try { git(session.sourceRoot, ["worktree", "remove", "--force", session.worktree]); }
  catch { try { rmSync(session.worktree, { recursive: true, force: true }); } catch {} }
  try { git(session.sourceRoot, ["worktree", "prune"]); } catch {}
}
export function captureAndRevert(root: string): CodeModification[] {
  const mods = captureNativeEditSession({ sourceRoot: root, worktree: root });
  try { git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "."]); } catch {}
  try { git(root, ["clean", "-fd"]); } catch {}
  return mods;
}
''',
)
replace("src/llm/proxy.ts", 'import { captureAndRevert, isNativeEditEligible } from "./native-capture.js";', 'import { captureNativeEditSession, disposeNativeEditSession, isNativeEditEligible, prepareNativeEditSession } from "./native-capture.js";')
replace(
    "src/llm/proxy.ts",
    '''    if (params.nativeEdit && params.root && isCliProvider(provider) && isNativeEditEligible(params.root)) {
      const adapter = getExecutionAdapter(provider);
      if (adapter) {
        let narration = "";
        await adapter.chat(
          model, apiKey, messages, { ...context, nativeEdit: true },
          onChunk,
          (r) => { narration = r.content; },
          cliOnError,
          signal
        );
        if (signal?.aborted) return;
        const modifications = captureAndRevert(params.root);
        onDone({
          content: narration || (modifications.length ? `Captured ${modifications.length} change(s) from the agent — review below.` : "The agent made no file changes."),
          modifications,
          parseStatus: "clean",
        });
        return;
      }
    }''',
    '''    if (params.nativeEdit && params.root && isCliProvider(provider) && isNativeEditEligible(params.root)) {
      const adapter = getExecutionAdapter(provider);
      if (adapter) {
        const session = prepareNativeEditSession(params.root);
        try {
          let narration = "";
          await adapter.chat(model, apiKey, messages, { ...context, nativeEdit: true, executionRoot: session.worktree }, onChunk, (r) => { narration = r.content; }, cliOnError, signal);
          if (signal?.aborted) return;
          const modifications = captureNativeEditSession(session);
          onDone({ content: narration || (modifications.length ? `Captured ${modifications.length} isolated change(s) — review below.` : "The agent made no file changes."), modifications, parseStatus: "clean" });
          return;
        } finally { disposeNativeEditSession(session); }
      }
    }''',
)
for adapter_path, fn in (("src/llm/claude-code.ts", "chatClaudeCode"), ("src/llm/codex-cli.ts", "chatCodexCli"), ("src/llm/gemini-cli.ts", "chatGeminiCli")):
    text = get(adapter_path)
    text = re.sub(
        r'''  const lastUserMsg = \[\.\.\.messages\]\.reverse\(\)\.find\(\(m\) => m\.role === "user"\);\n  const userPrompt =\n    typeof lastUserMsg\?\.content === "string"\n      \? lastUserMsg\.content\n      : "Help me with this element\.";''',
        '''  const userPrompt = messages.slice(-20).map((message) => {
    const content = typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "[image]").join(" ");
    return `${message.role.toUpperCase()}: ${content}`;
  }).join("\\n\\n") || "Help me with this element.";''',
        text,
        count=1,
    )
    text = text.replace("      cwd: process.cwd(),", "      cwd: context.executionRoot || process.cwd(),", 1)
    start, end = block(text, f"export async function {fn}(")
    text = text[:end - 1] + '''

  await new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    proc.once("close", () => resolve());
    proc.once("error", () => resolve());
  });
''' + text[end - 1:]
    put(adapter_path, text)

# ---------------------------------------------------------------------------
# Server credential/root routing
# ---------------------------------------------------------------------------
replace("src/server.ts", 'import { loadConfig, saveConfig } from "./config.js";', 'import { loadConfig, resolveProviderApiKey, saveConfig } from "./config.js";')
replace("src/server.ts", 'import { join, dirname } from "node:path";', 'import { basename, dirname, join } from "node:path";')
replace("src/server.ts", 'import { groundProject, type ProjectGroundRequest } from "./project-grounding.js";', 'import { groundProject, type ProjectGroundRequest } from "./project-grounding.js";\nimport { displayProjectPath, resolveProjectPath } from "./root-resolution.js";')
text = get("src/server.ts").replace('config.apiKeys?.[provider] || config.apiKey || ""', 'resolveProviderApiKey(config, provider)')
text = text.replace('hasApiKey: !!config.apiKey,', 'hasApiKey: !!resolveProviderApiKey(config, config.provider || ""),')
text = text.replace('hasApiKey: !!(config.apiKeys?.[provider] || config.apiKey),', 'hasApiKey: !!resolveProviderApiKey(config, provider),')
text = text.replace('        updates.apiKey = payload.apiKey; // backward compat\n', '')
text = text.replace('previewPatchGroup(roots[0] || process.cwd(), payload)', 'previewPatchGroup(roots, payload)')
text = text.replace('applyPatchGroup(roots[0] || process.cwd(), payload)', 'applyPatchGroup(roots, payload)')
text = text.replace('const root = roots[0] || process.cwd();\n      const result = payload.chain\n        ? rollbackChain(root, payload.groupId)\n        : rollbackPatchGroup(root, payload.groupId);', 'const result = payload.chain ? rollbackChain(roots, payload.groupId) : rollbackPatchGroup(roots, payload.groupId);')
text = text.replace('const result = readFileSafe(payload.path, roots);', 'const target = resolveProjectPath(roots, payload.path, { requireExisting: true });\n      const result = "error" in target ? target : readFileSafe(target.path, roots);')
text = text.replace('const writeResult = writeFileSafe(payload.path, payload.content, roots);', 'const target = resolveProjectPath(roots, payload.path, { allowCreate: true });\n      const writeResult = "error" in target ? { ok: false, error: target.error } : writeFileSafe(target.path, payload.content, roots);')
text = text.replace('const deleteResult = deleteFileSafe(payload.path, roots);', 'const target = resolveProjectPath(roots, payload.path, { requireExisting: true });\n      const deleteResult = "error" in target ? { ok: false, error: target.error } : deleteFileSafe(target.path, roots);')
text = text.replace('const undoResult = undoFileSafe(payload.path, roots);', 'const target = resolveProjectPath(roots, payload.path, { requireExisting: true });\n      const undoResult = "error" in target ? { ok: false, error: target.error, remainingUndoCount: 0 } : undoFileSafe(target.path, roots);')
text = text.replace('          root: roots[0],', '          root: roots[0],\n          roots,')
put("src/server.ts", text)

# ---------------------------------------------------------------------------
# DOM-safe visual editing, image composition, verification transparency
# ---------------------------------------------------------------------------
replace("src/toolbar/index.ts", 'editorRevert: null as { attrs: Record<string, string>; text: string } | null,', 'editorRevert: null as { attrs: Record<string, string>; text: string; html: string } | null,')
replace("src/toolbar/index.ts", 'state.editorRevert = { attrs, text: el.textContent || "" };', 'state.editorRevert = { attrs, text: el.textContent || "", html: el.innerHTML };')
replace("src/toolbar/index.ts", '    el.textContent = snap.text;', '    el.innerHTML = snap.html;')
replace(
    "src/toolbar/index.ts",
    '''  } else if (target.dataset.editText !== undefined) {
    el.textContent = value;''',
    '''  } else if (target.dataset.editText !== undefined) {
    const directText = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    if (el.children.length > 0) {
      if (directText.length !== 1) return;
      directText[0].nodeValue = value;
    } else el.textContent = value;''',
)
replace(
    "src/toolbar/index.ts",
    '''  } catch {
    reload(); // verification itself couldn't run — don't block the edit
    return;
  }''',
    '''  } catch (error) {
    armRuntimeCheck();
    state.messages.push({ role: "system", content: `Verification could not run: ${(error as Error).message}. Runtime rollback protection remains active.` });
    refreshPanelContent();
    reload();
    return;
  }''',
)
replace(
    "src/toolbar/index.ts",
    '''  if (verdict?.status !== "failed") {
    // passed or inconclusive — the change stands; arm the runtime check for after reload.
    armRuntimeCheck();
    reload();
    return;
  }''',
    '''  if (verdict?.status !== "failed") {
    if (verdict?.status === "inconclusive") {
      state.messages.push({ role: "system", content: `Build verification was inconclusive: ${verdict.reason || "no project check was available"}. Runtime rollback protection remains active.` });
      refreshPanelContent();
    }
    armRuntimeCheck(); reload(); return;
  }''',
)
replace(
    "src/toolbar/services/capture.ts",
    '''    // Clone children with depth limit
    for (let i = 0; i < source.children.length && i < 20; i++) {
      const child = cloneWithStyles(source.children[i] as HTMLElement, depth + 1, maxDepth);
      if (child) clone.appendChild(child);
    }''',
    '''    const children = Array.from(source.childNodes).slice(0, 40);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) clone.appendChild(document.createTextNode(node.textContent || ""));
      else if (node instanceof HTMLElement) {
        const child = cloneWithStyles(node, depth + 1, maxDepth);
        if (child) clone.appendChild(child);
      }
    }''',
)

# ---------------------------------------------------------------------------
# Static SPA routing and grounding
# ---------------------------------------------------------------------------
replace("src/static-server.ts", 'import { extname, relative, resolve } from "node:path";', 'import { existsSync } from "node:fs";\nimport { extname, relative, resolve } from "node:path";')
replace("src/static-server.ts", "  return candidate;\n}", '  if (!existsSync(candidate) && extname(pathname) === "") {\n    const index = resolve(root, "index.html");\n    if (existsSync(index)) return index;\n  }\n  return candidate;\n}', 1)
replace("src/project-grounding.ts", 'const TEXT_RE = /\\.(?:[cm]?[jt]sx?|json|svelte|vue|astro|html?|css|scss|less|php|py|rb|blade\\.php)$/i;', 'const TEXT_RE = /\\.(?:[cm]?[jt]sx?|json|svelte|vue|astro|html?|css|scss|less|mdx?|graphql|gql|prisma|sql|php|py|rb|go|java|cs|rs|twig|erb|blade\\.php)$/i;')
replace("src/project-grounding.ts", '  if (deps.vue || existsSync(join(root, "vite.config.ts"))) return deps.react ? "vite-react" : "vue";\n  if (deps.react || existsSync(join(root, "src/App.tsx")) || existsSync(join(root, "src/App.jsx"))) return "vite-react";', '  if (deps.vue) return "vue";\n  if (deps.react || existsSync(join(root, "src/App.tsx")) || existsSync(join(root, "src/App.jsx"))) return "vite-react";\n  if (deps.vite || existsSync(join(root, "vite.config.ts")) || existsSync(join(root, "vite.config.js"))) return "vite";')

# ---------------------------------------------------------------------------
# Process ownership, cross-platform startup, and input validation
# ---------------------------------------------------------------------------
replace("src/cli.ts", 'let lastDetectedPort: number | null = null; // Port detected from dev server output', 'let lastDetectedPort: number | null = null; // Port detected from dev server output\nlet ownsTargetServer = false;')
replace("src/cli.ts", 'resolve(res.statusCode !== undefined && res.statusCode < 400);', 'resolve(res.statusCode !== undefined);')
replace("src/cli.ts", '        shell: "/bin/sh",', '        shell: false,')
sub(
    "src/cli.ts",
    r'''    // Wrap in shell with ulimit[\s\S]*?    child = spawn\("sh", \["-c", shellCmd\], \{\n      cwd: process\.cwd\(\),\n      stdio: "inherit",\n      env: \{\n        \.\.\.process\.env,\n        PORT: String\(port\),\n        BROWSER: "none",\n        BROWSER_NONE: "true",\n      },\n    }\);''',
    '''    child = spawn(runCmd, runArgs, {
      cwd: process.cwd(), stdio: "inherit", shell: false,
      env: { ...process.env, PORT: String(port), BROWSER: "none", BROWSER_NONE: "true" },
    });
    ownsTargetServer = true;''',
    flags=re.S,
)
replace("src/cli.ts", "      childProcesses.push(staticChild);", "      childProcesses.push(staticChild);\n      ownsTargetServer = true;", 1)
replace("src/cli.ts", "      if (targetPort) {\n        killPortProcess(targetPort);\n      }", "      if (ownsTargetServer && targetPort) {\n        killPortProcess(targetPort);\n      }")
replace("src/cli.ts", "      if (targetPort && (await isPortOpen(targetPort))) {", "      if (ownsTargetServer && targetPort && (await isPortOpen(targetPort))) {")
replace(
    "src/cli.ts",
    "\nconst program = new Command();",
    '''

export function parsePort(value: string | number, label: string): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} must be an integer between 1 and 65535`);
  return port;
}

const program = new Command();''',
)
replace("src/cli.ts", "targetPort = parseInt(opts.port, 10);", 'targetPort = parsePort(opts.port, "--port");')
replace("src/cli.ts", "const requestedProxyPort = parseInt(opts.listen, 10);", 'const requestedProxyPort = parsePort(opts.listen, "--listen");')
replace("src/detect.ts", 'import { join, resolve } from "node:path";', 'import { isAbsolute, join, relative, resolve, sep } from "node:path";')
replace(
    "src/detect.ts",
    '''        // Match if the process cwd is the project dir, a parent, or a child
        if (processCwd === expected || expected.startsWith(processCwd) || processCwd.startsWith(expected)) {
          return true;
        }''',
    '''        const fromExpected = relative(expected, processCwd), fromProcess = relative(processCwd, expected);
        const nested = (value: string) => value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
        if (nested(fromExpected) || nested(fromProcess)) return true;''',
)

# ---------------------------------------------------------------------------
# Public version and CI matrix
# ---------------------------------------------------------------------------
put("docs/index.html", get("docs/index.html").replace("v0.31.1", "v0.44.2"))
replace(".github/workflows/ci.yml", "    runs-on: ubuntu-latest\n\n    strategy:\n      matrix:\n        node-version: [20, 22]", "    runs-on: ${{ matrix.os }}\n\n    strategy:\n      fail-fast: false\n      matrix:\n        os: [ubuntu-latest, windows-latest, macos-latest]\n        node-version: [20, 22]")
replace(".github/workflows/ci.yml", "if: matrix.node-version == 22", "if: matrix.os == 'ubuntu-latest' && matrix.node-version == 22", 2)

# Regression coverage
put(
    "tests/audit-regressions.test.ts",
    '''import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProviderApiKey } from "../src/config.js";
import { writeFileSafe } from "../src/filesystem.js";
import { resolveProjectPath } from "../src/root-resolution.js";
import { buildGoogleRequest } from "../src/llm/google.js";
import { resolveStaticRequestPath } from "../src/static-server.js";
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
const temp = () => { const d = mkdtempSync(join(tmpdir(), "om-audit-")); dirs.push(d); return d; };
describe("audit regressions", () => {
  it("isolates provider keys", () => {
    const config = { provider: "openai", apiKey: "legacy", apiKeys: { openai: "openai-key" } };
    expect(resolveProviderApiKey(config, "openai")).toBe("openai-key");
    expect(resolveProviderApiKey(config, "anthropic")).toBe("");
  });
  it("preserves executable mode and refuses symlinks", () => {
    const root = temp(), file = join(root, "run.sh");
    writeFileSync(file, "one"); chmodSync(file, 0o755);
    expect(writeFileSafe(file, "two", [root]).ok).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o755);
    const target = join(root, "target"), link = join(root, "link");
    writeFileSync(target, "safe"); symlinkSync(target, link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(writeFileSafe(link, "bad", [root]).ok).toBe(false);
    expect(readFileSync(target, "utf-8")).toBe("safe");
  });
  it("rejects ambiguous multi-root paths", () => {
    const a = temp(), b = temp(); writeFileSync(join(a, "same.ts"), "a"); writeFileSync(join(b, "same.ts"), "b");
    expect(resolveProjectPath([a, b], "same.ts", { requireExisting: true })).toHaveProperty("error");
  });
  it("places Gemini thinking under generationConfig and includes images", () => {
    const body: any = buildGoogleRequest("gemini-3.1-pro-preview", [{ role: "user", content: "hi" }], { reasoningLevel: "high", screenshot: "data:image/png;base64,AAA", attachments: ["data:image/jpeg;base64,BBB"] });
    expect(body.thinkingConfig).toBeUndefined();
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBeTruthy();
    expect(body.contents[0].parts.filter((part: any) => part.inline_data)).toHaveLength(2);
  });
  it("serves index.html for static SPA routes", () => {
    const root = temp(); writeFileSync(join(root, "index.html"), "app");
    expect(resolveStaticRequestPath(root, "/dashboard")).toBe(join(root, "index.html"));
  });
});
''',
)

# Remove temporary export workflow used only to obtain the initial review snapshot.
export = ROOT / ".github/workflows/source-export.yml"
if export.exists(): export.unlink()
print("comprehensive audit repair applied")
