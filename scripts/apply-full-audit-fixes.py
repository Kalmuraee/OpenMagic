from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f"Expected text not found in {path}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    content = read(path)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, got {count}: {pattern[:120]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# Provider-bound credential storage (OM-001) + private config permissions.
# ---------------------------------------------------------------------------
write("src/config.ts", r'''
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { OpenMagicConfig } from "./shared-types.js";

const CONFIG_DIR = join(homedir(), ".openmagic");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

type StoredConfig = Partial<OpenMagicConfig>;

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  try { chmodSync(CONFIG_DIR, 0o700); } catch { /* best effort on Windows */ }
}

function normalizeLegacyConfig(input: StoredConfig): { config: StoredConfig; migrated: boolean } {
  const config: StoredConfig = { ...input, apiKeys: { ...(input.apiKeys || {}) } };
  let migrated = false;

  // Versions before 0.45 duplicated the last-saved provider key into `apiKey`.
  // Migrate it only to the provider that was selected when it was stored. Never
  // use a global key as a fallback for a different provider.
  if (typeof config.apiKey === "string" && config.apiKey && config.provider) {
    if (!config.apiKeys?.[config.provider]) {
      config.apiKeys = { ...(config.apiKeys || {}), [config.provider]: config.apiKey };
    }
    delete config.apiKey;
    migrated = true;
  }

  if (config.apiKeys && Object.keys(config.apiKeys).length === 0) delete config.apiKeys;
  return { config, migrated };
}

function persistConfig(config: StoredConfig): void {
  ensureConfigDir();
  const tmpFile = `${CONFIG_FILE}.tmp-${process.pid}`;
  writeFileSync(tmpFile, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
  try { chmodSync(tmpFile, 0o600); } catch { /* best effort */ }
  renameSync(tmpFile, CONFIG_FILE);
  try { chmodSync(CONFIG_FILE, 0o600); } catch { /* best effort */ }
}

export function loadConfig(): StoredConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) return {};

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as StoredConfig;
    const normalized = normalizeLegacyConfig(parsed);
    if (normalized.migrated) {
      try { persistConfig(normalized.config); } catch { /* read still succeeds */ }
    }
    return normalized.config;
  } catch {
    return {};
  }
}

export function saveConfig(updates: StoredConfig): { ok: boolean; error?: string } {
  try {
    const existing = loadConfig();
    const merged: StoredConfig = { ...existing, ...updates };

    // Accept the legacy field only as an explicit migration input bound to an
    // explicit/current provider; remove it before writing.
    if (typeof updates.apiKey === "string") {
      const provider = updates.provider || existing.provider;
      if (!provider) throw new Error("Cannot save an API key without a provider");
      merged.apiKeys = { ...(existing.apiKeys || {}), ...(updates.apiKeys || {}), [provider]: updates.apiKey };
    }
    delete merged.apiKey;

    persistConfig(merged);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: (error as Error).message };
  }
}

export function getProviderApiKey(config: StoredConfig, provider: string): string {
  return provider ? config.apiKeys?.[provider] || "" : "";
}

export function hasProviderApiKey(config: StoredConfig, provider: string): boolean {
  return !!getProviderApiKey(config, provider);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getConfigDir(): string {
  ensureConfigDir();
  return CONFIG_DIR;
}
''')

# Context carries every image and the project root used by local CLI agents.
shared = read("src/shared-types.ts")
shared = shared.replace(
    "  screenshot?: string; // base64 data URL\n",
    "  screenshot?: string; // base64 data URL\n  attachments?: string[]; // additional base64 image data URLs\n  projectRoot?: string; // actual execution cwd for local CLI agents\n",
)
shared = shared.replace(
    "  apiKey?: string;\n  apiKeys?: Record<string, string>; // per-provider key storage\n",
    "  apiKey?: string; // legacy migration input only; never a cross-provider fallback\n  apiKeys?: Record<string, string>; // provider-bound key storage\n",
)
write("src/shared-types.ts", shared)

# ---------------------------------------------------------------------------
# Multi-root path resolution (OM-016) and safe path display.
# ---------------------------------------------------------------------------
write("src/root-resolver.ts", r'''
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ResolvedProjectPath {
  root: string;
  absolutePath: string;
  relativePath: string;
  displayPath: string;
}

export type ResolveProjectPathResult = ResolvedProjectPath | { error: string };

export function normalizeRoots(roots: string | string[]): string[] {
  const values = Array.isArray(roots) ? roots : [roots];
  return [...new Set(values.filter(Boolean).map((root) => resolve(root)))];
}

export function isPathWithinRoot(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function uniqueAliases(roots: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const root of roots) counts.set(basename(root), (counts.get(basename(root)) || 0) + 1);
  const aliases = new Map<string, string>();
  roots.forEach((root, index) => {
    const base = basename(root);
    aliases.set(counts.get(base) === 1 ? base : `root-${index + 1}`, root);
  });
  return aliases;
}

export function rootAlias(root: string, rootsInput: string | string[]): string {
  const roots = normalizeRoots(rootsInput);
  for (const [alias, candidate] of uniqueAliases(roots)) {
    if (candidate === resolve(root)) return alias;
  }
  return basename(root);
}

export function displayPathFor(root: string, relativePath: string, rootsInput: string | string[]): string {
  const roots = normalizeRoots(rootsInput);
  const normalized = relativePath.replace(/\\/g, "/");
  return roots.length > 1 ? `${rootAlias(root, roots)}/${normalized}` : normalized;
}

export function resolveProjectPath(
  requestedPath: string,
  rootsInput: string | string[],
  options: { mustExist?: boolean; forCreate?: boolean } = {}
): ResolveProjectPathResult {
  const roots = normalizeRoots(rootsInput);
  if (!roots.length) return { error: "No project roots are configured" };
  if (!requestedPath || typeof requestedPath !== "string") return { error: "Missing path" };

  const requested = requestedPath.replace(/\\/g, "/");

  if (isAbsolute(requestedPath)) {
    const absolutePath = resolve(requestedPath);
    const root = roots.find((candidate) => isPathWithinRoot(absolutePath, candidate));
    if (!root) return { error: "Path is outside configured project roots" };
    if (options.mustExist && !existsSync(absolutePath)) return { error: "File not found" };
    const relativePath = relative(root, absolutePath);
    return { root, absolutePath, relativePath, displayPath: displayPathFor(root, relativePath, roots) };
  }

  for (const [alias, root] of uniqueAliases(roots)) {
    if (requested === alias || requested.startsWith(`${alias}/`)) {
      const rel = requested === alias ? "" : requested.slice(alias.length + 1);
      const absolutePath = resolve(root, rel);
      if (!isPathWithinRoot(absolutePath, root)) return { error: "Path is outside configured project roots" };
      if (options.mustExist && !existsSync(absolutePath)) return { error: "File not found" };
      return { root, absolutePath, relativePath: rel, displayPath: displayPathFor(root, rel, roots) };
    }
  }

  const existing = roots
    .map((root) => ({ root, absolutePath: resolve(root, requested) }))
    .filter((item) => isPathWithinRoot(item.absolutePath, item.root) && existsSync(item.absolutePath));
  if (existing.length > 1) return { error: `Ambiguous path exists in multiple roots: ${requestedPath}` };
  if (existing.length === 1) {
    const item = existing[0];
    const relativePath = relative(item.root, item.absolutePath);
    return { ...item, relativePath, displayPath: displayPathFor(item.root, relativePath, roots) };
  }

  if (options.forCreate) {
    const parentMatches = roots
      .map((root) => ({ root, absolutePath: resolve(root, requested) }))
      .filter((item) => isPathWithinRoot(item.absolutePath, item.root) && existsSync(dirname(item.absolutePath)));
    if (parentMatches.length === 1) {
      const item = parentMatches[0];
      const relativePath = relative(item.root, item.absolutePath);
      return { ...item, relativePath, displayPath: displayPathFor(item.root, relativePath, roots) };
    }
    if (parentMatches.length > 1 && roots.length > 1) {
      return { error: `Ambiguous create path; prefix it with a project root: ${requestedPath}` };
    }
  }

  const root = roots[0];
  const absolutePath = resolve(root, requested);
  if (!isPathWithinRoot(absolutePath, root)) return { error: "Path is outside configured project roots" };
  if (options.mustExist) return { error: "File not found" };
  const relativePath = relative(root, absolutePath);
  return { root, absolutePath, relativePath, displayPath: displayPathFor(root, relativePath, roots) };
}
''')

# ---------------------------------------------------------------------------
# Filesystem durability: unique backup dirs, modes, snapshots, symlink refusal.
# OM-012, OM-017, OM-028, OM-029.
# ---------------------------------------------------------------------------
fs = read("src/filesystem.ts")
fs = fs.replace('import { createHash } from "node:crypto";', 'import { createHash, randomBytes } from "node:crypto";')
fs = fs.replace(
    'const BACKUP_DIR = join(tmpdir(), "openmagic-backups");',
    'const BACKUP_DIR = process.env.OPENMAGIC_BACKUP_DIR || join(tmpdir(), `openmagic-backups-${process.pid}-${randomBytes(6).toString("hex")}`);',
)
fs = fs.replace(
    'type BackupEntry = { backupPath?: string; existed: boolean };',
    'type BackupEntry = { backupPath?: string; existed: boolean; mode?: number };',
)
fs = fs.replace(
    '  return { existed: true, backupPath };',
    '  return { existed: true, backupPath, mode: statSync(filePath).mode & 0o777 };',
    1,
)
regex = re.compile(r'function atomicWriteFile\(filePath: string, data: string \| Buffer\): void \{.*?\n\}', re.S)
replacement = r'''function atomicWriteFile(filePath: string, data: string | Buffer, requestedMode?: number): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
    throw new Error("Refusing to replace a symbolic link");
  }

  const existingMode = existsSync(filePath) ? (statSync(filePath).mode & 0o777) : undefined;
  const mode = requestedMode ?? existingMode ?? 0o600;
  const tmpPath = join(dir, `.${parse(filePath).base}.openmagic-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let fd: number | undefined;
  try {
    fd = openSync(tmpPath, "w", mode);
    if (Buffer.isBuffer(data)) writeSync(fd, data);
    else writeSync(fd, data, 0, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath);
    fsyncDir(dir);
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    try { unlinkSync(tmpPath); } catch {}
    throw error;
  }
}'''
fs, count = regex.subn(replacement, fs, count=1)
if count != 1:
    raise RuntimeError("Could not replace atomicWriteFile")
fs = fs.replace(
    '  try {\n    const backupPath = pushBackup(filePath, createBackupEntry(filePath));',
    '  try {\n    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {\n      return { ok: false, error: "Refusing to edit a symbolic link" };\n    }\n    const backupPath = pushBackup(filePath, createBackupEntry(filePath));',
    1,
)
fs = fs.replace('      atomicWriteFile(filePath, raw);', '      atomicWriteFile(filePath, raw, entry.mode);', 1)
insert_marker = 'const MAX_LIST_ENTRIES = 2000;'
snapshot_code = r'''
export interface FileSnapshot {
  existed: boolean;
  contentBase64?: string;
  mode?: number;
}

export function captureFileSnapshotSafe(filePath: string, roots: string[]): FileSnapshot | { error: string } {
  if (!isPathSafe(filePath, roots)) return { error: "Path is outside allowed roots" };
  if (!existsSync(filePath)) return { existed: false };
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink()) return { error: "Refusing to snapshot a symbolic link" };
    if (!stat.isFile()) return { error: "Can only snapshot regular files" };
    return {
      existed: true,
      contentBase64: readFileSync(filePath).toString("base64"),
      mode: stat.mode & 0o777,
    };
  } catch (error) {
    return { error: `Failed to snapshot file: ${(error as Error).message}` };
  }
}

export function restoreFileSnapshotSafe(filePath: string, snapshot: FileSnapshot, roots: string[]): { ok: boolean; error?: string } {
  if (!isPathSafe(filePath, roots)) return { ok: false, error: "Path is outside allowed roots" };
  try {
    if (!snapshot.existed) {
      if (existsSync(filePath)) {
        if (lstatSync(filePath).isSymbolicLink()) return { ok: false, error: "Refusing to delete a symbolic link" };
        unlinkSync(filePath);
        fsyncDir(dirname(filePath));
      }
      return { ok: true };
    }
    if (!snapshot.contentBase64) return { ok: false, error: "Snapshot content is missing" };
    atomicWriteFile(filePath, Buffer.from(snapshot.contentBase64, "base64"), snapshot.mode);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Snapshot restore failed: ${(error as Error).message}` };
  }
}

'''
if insert_marker not in fs:
    raise RuntimeError("Could not insert filesystem snapshots")
fs = fs.replace(insert_marker, snapshot_code + insert_marker, 1)
write("src/filesystem.ts", fs)

# ---------------------------------------------------------------------------
# Durable patch manifests preserve raw bytes/modes and chain rollback is atomic.
# OM-018, OM-027, OM-028.
# ---------------------------------------------------------------------------
patch = read("src/patch.ts")
patch = patch.replace(
    'import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";',
    'import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";',
)
patch = patch.replace(
    'import { deleteFileSafe, isPathSafe, readFileSafe, writeFileSafe } from "./filesystem.js";',
    'import { captureFileSnapshotSafe, deleteFileSafe, isPathSafe, readFileSafe, restoreFileSnapshotSafe, writeFileSafe, type FileSnapshot } from "./filesystem.js";',
)
patch = patch.replace(
    '  files: Array<{\n    path: string;\n    existed: boolean;\n    content: string;\n  }>;',
    '  files: Array<{ path: string; snapshot: FileSnapshot; content?: string; existed?: boolean }>;',
)
patch = patch.replace(
    '    mkdirSync(manifestDir(), { recursive: true });\n    const tmp = `${manifestPath(manifest.groupId)}.tmp`;\n    writeFileSync(tmp, JSON.stringify(manifest), "utf-8");\n    renameSync(tmp, manifestPath(manifest.groupId));',
    '    mkdirSync(manifestDir(), { recursive: true, mode: 0o700 });\n    try { chmodSync(manifestDir(), 0o700); } catch {}\n    const tmp = `${manifestPath(manifest.groupId)}.tmp-${process.pid}`;\n    writeFileSync(tmp, JSON.stringify(manifest), { encoding: "utf-8", mode: 0o600 });\n    try { chmodSync(tmp, 0o600); } catch {}\n    renameSync(tmp, manifestPath(manifest.groupId));\n    try { chmodSync(manifestPath(manifest.groupId), 0o600); } catch {}',
)
old_manifest = '''    files: planned.map((item) => ({
      path: item.path,
      existed: item.existed,
      content: item.originalContent,
    })),'''
new_manifest = '''    files: planned.map((item) => {
      const snapshot = captureFileSnapshotSafe(item.path, [root]);
      if ("error" in snapshot) throw new Error(snapshot.error);
      return { path: item.path, snapshot };
    }),'''
if old_manifest not in patch:
    raise RuntimeError("Patch manifest creation block not found")
patch = patch.replace(old_manifest, new_manifest, 1)
old_rollback = '''  for (const file of manifest.files) {
    if (file.existed) {
      const result = writeFileSafe(file.path, file.content, [root]);
      if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to restore ${file.path}` };
    } else if (existsSync(file.path)) {
      const result = deleteFileSafe(file.path, [root]);
      if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to remove ${file.path}` };
    }
  }'''
new_rollback = '''  for (const file of manifest.files) {
    const snapshot: FileSnapshot = file.snapshot || {
      existed: !!file.existed,
      contentBase64: file.existed && typeof file.content === "string"
        ? Buffer.from(file.content, "utf-8").toString("base64")
        : undefined,
    };
    const result = restoreFileSnapshotSafe(file.path, snapshot, [root]);
    if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to restore ${file.path}` };
  }'''
if old_rollback not in patch:
    raise RuntimeError("Patch rollback block not found")
patch = patch.replace(old_rollback, new_rollback, 1)
regex_chain = re.compile(r'export function rollbackChain\(root: string, groupId: string\): \{ ok: boolean; error\?: string; groupId: string; files\?: string\[\] \} \{.*?\n\}', re.S)
new_chain = r'''export function rollbackChain(root: string, groupId: string): { ok: boolean; error?: string; groupId: string; files?: string[] } {
  const visited = new Set<string>();
  const chain: PatchManifest[] = [];
  let current: string | undefined = groupId;

  // Resolve the complete chain before touching files. Missing/corrupt parents
  // must not produce a partial rollback reported as success.
  while (current) {
    if (visited.has(current)) return { ok: false, groupId, error: "Patch chain contains a cycle" };
    visited.add(current);
    const manifest = loadManifest(current);
    if (!manifest) return { ok: false, groupId, error: `Patch group not found: ${current}` };
    chain.push(manifest);
    current = manifest.parentGroupId;
  }

  const files: string[] = [];
  for (const manifest of chain) {
    const result = rollbackPatchGroup(root, manifest.groupId);
    if (!result.ok) return { ok: false, groupId, error: result.error };
    if (result.files) files.push(...result.files);
  }
  return { ok: true, groupId, files: [...new Set(files)] };
}'''
patch, count = regex_chain.subn(new_chain, patch, count=1)
if count != 1:
    raise RuntimeError("rollbackChain replacement failed")
write("src/patch.ts", patch)

# ---------------------------------------------------------------------------
# Multi-root atomic patch wrapper; child manifests remain durable.
# ---------------------------------------------------------------------------
write("src/multi-root-patch.ts", r'''
import {
  applyPatchGroup,
  previewPatchGroup,
  rollbackChain,
  rollbackPatchGroup,
  type FilePatch,
  type PatchApplyResult,
  type PatchGroupRequest,
  type PatchPreviewChange,
  type PatchPreviewResult,
} from "./patch.js";
import { normalizeRoots, resolveProjectPath } from "./root-resolver.js";

interface RootGroup {
  root: string;
  patches: FilePatch[];
  originals: string[];
}

function partition(rootsInput: string[], request: PatchGroupRequest): { groups?: RootGroup[]; errors?: PatchPreviewChange[] } {
  const roots = normalizeRoots(rootsInput);
  const groups = new Map<string, RootGroup>();
  const errors: PatchPreviewChange[] = [];

  for (const patch of request.patches) {
    const resolved = resolveProjectPath(patch.file, roots, {
      mustExist: patch.type !== "create",
      forCreate: patch.type === "create",
    });
    if ("error" in resolved) {
      errors.push({ file: patch.file, type: patch.type, ok: false, reason: resolved.error });
      continue;
    }
    const group = groups.get(resolved.root) || { root: resolved.root, patches: [], originals: [] };
    group.originals.push(patch.file);
    group.patches.push({ ...patch, file: resolved.relativePath } as FilePatch);
    groups.set(resolved.root, group);
  }
  return errors.length ? { errors } : { groups: [...groups.values()] };
}

function restoreNames(changes: PatchPreviewChange[], originals: string[]): PatchPreviewChange[] {
  return changes.map((change, index) => ({ ...change, file: originals[index] || change.file }));
}

function encodeComposite(children: Array<{ root: string; groupId: string }>): string {
  return `multi_${Buffer.from(JSON.stringify(children), "utf-8").toString("base64url")}`;
}

function decodeComposite(groupId: string): Array<{ root: string; groupId: string }> | null {
  if (!groupId.startsWith("multi_")) return null;
  try { return JSON.parse(Buffer.from(groupId.slice(6), "base64url").toString("utf-8")); } catch { return null; }
}

export function previewPatchGroupAcrossRoots(roots: string[], request: PatchGroupRequest): PatchPreviewResult {
  const parts = partition(roots, request);
  if (parts.errors) return { ok: false, changes: parts.errors };
  const changes: PatchPreviewChange[] = [];
  for (const group of parts.groups || []) {
    const result = previewPatchGroup(group.root, { ...request, patches: group.patches, parentGroupId: undefined });
    changes.push(...restoreNames(result.changes, group.originals));
  }
  return { ok: changes.every((change) => change.ok), changes };
}

export function applyPatchGroupAcrossRoots(roots: string[], request: PatchGroupRequest): PatchApplyResult {
  const parts = partition(roots, request);
  if (parts.errors) return { ok: false, applied: false, changes: parts.errors };
  if (request.dryRun) return { ...previewPatchGroupAcrossRoots(roots, request), applied: false };

  const children: Array<{ root: string; groupId: string }> = [];
  const changes: PatchPreviewChange[] = [];
  for (const group of parts.groups || []) {
    const result = applyPatchGroup(group.root, { patches: group.patches });
    changes.push(...restoreNames(result.changes, group.originals));
    if (!result.ok || !result.applied || !result.groupId) {
      for (const child of [...children].reverse()) rollbackPatchGroup(child.root, child.groupId);
      return { ok: false, applied: false, changes };
    }
    children.push({ root: group.root, groupId: result.groupId });
  }

  const groupId = children.length === 1 ? children[0].groupId : encodeComposite(children);
  return { ok: true, applied: true, groupId, changes };
}

export function rollbackPatchGroupAcrossRoots(
  roots: string[],
  groupId: string,
  chain = false
): { ok: boolean; error?: string; groupId: string; files?: string[] } {
  const children = decodeComposite(groupId);
  if (!children) {
    for (const root of normalizeRoots(roots)) {
      const result = chain ? rollbackChain(root, groupId) : rollbackPatchGroup(root, groupId);
      if (result.ok) return result;
      if (result.error !== "Patch group not found") return result;
    }
    return { ok: false, groupId, error: "Patch group not found" };
  }

  const files: string[] = [];
  for (const child of [...children].reverse()) {
    const result = chain ? rollbackChain(child.root, child.groupId) : rollbackPatchGroup(child.root, child.groupId);
    if (!result.ok) return { ok: false, groupId, error: result.error };
    if (result.files) files.push(...result.files);
  }
  return { ok: true, groupId, files: [...new Set(files)] };
}
''')

# ---------------------------------------------------------------------------
# Verification runs every configured gate, grouped by root (OM-020).
# ---------------------------------------------------------------------------
write("src/verify.ts", r'''
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
    const label = roots.length > 1 ? basename(root) : "project";
    const json = verifyTouchedFiles(root, files);
    ran.push(`${label}:json-parse`);
    if (!json.ok) return { status: "failed", ran, errors: json.errors };

    const scripts = detectVerifyScripts(root);
    configured += scripts.length;
    for (const script of scripts) {
      const result = await runVerifyScript(root, script, opts.timeoutMs ?? 20_000, opts.signal);
      ran.push(`${label}:${script}`);
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
''')

# ---------------------------------------------------------------------------
# Child lifecycle and isolated native edit worktrees (OM-006..OM-011).
# ---------------------------------------------------------------------------
write("src/llm/child-process.ts", r'''
import { execFileSync, type ChildProcess } from "node:child_process";

export function terminateChildProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else if (child.spawnargs.length) {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try { child.kill(signal); } catch {}
  }
}
''')

write("src/llm/native-capture.ts", r'''
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
''')

# Patch each CLI adapter so the returned Promise follows process close, uses the
# project root, and cancellation kills the complete process tree.
for path in ["src/llm/claude-code.ts", "src/llm/codex-cli.ts", "src/llm/gemini-cli.ts"]:
    content = read(path)
    if 'from "./child-process.js"' not in content:
        content = content.replace(
            'import { spawn } from "node:child_process";',
            'import { spawn } from "node:child_process";\nimport { terminateChildProcessTree } from "./child-process.js";',
            1,
        )
    content = content.replace('      cwd: process.cwd(),', '      cwd: context.projectRoot || process.cwd(),')
    content = content.replace('      cwd: process.cwd()', '      cwd: context.projectRoot || process.cwd()')
    content = content.replace('      stdio: ["pipe", "pipe", "pipe"],\n      cwd:', '      stdio: ["pipe", "pipe", "pipe"],\n      detached: process.platform !== "win32",\n      cwd:')
    content = content.replace('proc.kill("SIGTERM")', 'terminateChildProcessTree(proc)')

    # Existing functions register callbacks then fall through immediately. Wrap
    # everything from the spawn declaration through the end of the function in a
    # Promise by inserting before spawn and resolving in error/close callbacks.
    spawn_marker = '  const proc = spawn('
    if spawn_marker not in content:
        raise RuntimeError(f"spawn marker missing in {path}")
    content = content.replace(spawn_marker, '  await new Promise<void>((resolve) => {\n  let processSettled = false;\n  const settle = () => { if (!processSettled) { processSettled = true; resolve(); } };\n\n  const proc = spawn(', 1)

    # Add settle after each terminal callback. The error callback can be followed
    # by close, so settle is idempotent.
    content = content.replace('  proc.on("error", (err) => {', '  proc.on("error", (err) => {', 1)
    # Insert settle immediately before the error callback closes (the first `  });`
    err_start = content.index('  proc.on("error", (err) => {')
    err_end = content.index('\n  });', err_start)
    content = content[:err_end] + '\n    settle();' + content[err_end:]

    close_start = content.index('  proc.on("close", (code) => {')
    close_end = content.index('\n  });', close_start)
    content = content[:close_end] + '\n    settle();' + content[close_end:]

    # Close Promise after the close handler, before the function's final brace.
    close_end = content.index('\n  });', close_start) + len('\n  });')
    content = content[:close_end] + '\n  });' + content[close_end:]
    write(path, content)

# ---------------------------------------------------------------------------
# LLM orchestration uses isolated sessions and provider-bound roots.
# ---------------------------------------------------------------------------
llm_proxy = read("src/llm/proxy.ts")
llm_proxy = llm_proxy.replace(
    'import { captureAndRevert, isNativeEditEligible } from "./native-capture.js";',
    'import { captureNativeEditSession, closeNativeEditSession, createNativeEditSession, isNativeEditEligible } from "./native-capture.js";',
)
llm_proxy = llm_proxy.replace(
    '  root?: string;        // project root, required for tool execution / native capture\n',
    '  root?: string;        // primary project root\n  roots?: string[];      // all configured project roots\n',
)
old_native = re.compile(r'    if \(params\.nativeEdit && params\.root && isCliProvider\(provider\) && isNativeEditEligible\(params\.root\)\) \{.*?\n    \}', re.S)
new_native = r'''    if (params.nativeEdit && params.root && isCliProvider(provider) && isNativeEditEligible(params.root)) {
      if ((params.roots?.length || 1) > 1) {
        onError("Native edit is disabled for multi-root sessions; use reviewed patch mode instead.");
        return;
      }
      const adapter = getExecutionAdapter(provider);
      if (adapter) {
        const session = createNativeEditSession(params.root);
        try {
          let narration = "";
          await adapter.chat(
            model, apiKey, messages,
            { ...context, nativeEdit: true, projectRoot: session.workspace },
            onChunk,
            (result) => { narration = result.content; },
            cliOnError,
            signal
          );
          if (signal?.aborted) return;
          const modifications = captureNativeEditSession(session);
          onDone({
            content: narration || (modifications.length
              ? `Captured ${modifications.length} change(s) from the agent — review below.`
              : "The agent made no file changes."),
            modifications,
            parseStatus: "clean",
          });
          return;
        } finally {
          closeNativeEditSession(session);
        }
      }
    }'''
llm_proxy, count = old_native.subn(new_native, llm_proxy, count=1)
if count != 1:
    raise RuntimeError("Native-edit orchestration block not found")
llm_proxy = llm_proxy.replace(
    '(name, args) => executeServerTool(name, args, params.root!, [params.root!]),',
    '(name, args) => executeServerTool(name, args, params.root!, params.roots?.length ? params.roots : [params.root!]),',
)
llm_proxy = llm_proxy.replace(
    'await adapter.chat(model, apiKey, messages, context, onChunk, wrappedOnDone, adapterOnError, signal);',
    'await adapter.chat(model, apiKey, messages, { ...context, projectRoot: params.root }, onChunk, wrappedOnDone, adapterOnError, signal);',
)
write("src/llm/proxy.ts", llm_proxy)

# ---------------------------------------------------------------------------
# Exact paged tool reads (OM-026).
# ---------------------------------------------------------------------------
tools = read("src/llm/tools.ts")
tools = tools.replace(
    'properties: { path: { type: "string", description: "Path relative to project root" } },\n      required: ["path"],',
    'properties: {\n        path: { type: "string", description: "Path relative to project root" },\n        offset: { type: "integer", minimum: 0, description: "Character offset (default 0)" },\n        limit: { type: "integer", minimum: 1, maximum: 16000, description: "Characters to return (default/max 16000)" },\n      },\n      required: ["path"],',
    1,
)
old_read_tool = '''      const content = read.content.length > MAX_TOOL_FILE_CHARS
        ? read.content.slice(0, MAX_TOOL_FILE_CHARS) + `\n// [truncated at ${MAX_TOOL_FILE_CHARS} chars]`
        : read.content;
      return { content: `Contents of ${rel}:\n${content}` };'''
new_read_tool = '''      const offset = Math.max(0, Number.isFinite(Number(args.offset)) ? Math.floor(Number(args.offset)) : 0);
      const limit = Math.min(MAX_TOOL_FILE_CHARS, Math.max(1, Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : MAX_TOOL_FILE_CHARS));
      const chunk = read.content.slice(offset, offset + limit);
      const nextOffset = offset + chunk.length < read.content.length ? offset + chunk.length : null;
      return {
        content: `Contents of ${rel} [${offset}:${offset + chunk.length}] of ${read.content.length}:\n${chunk}` +
          (nextOffset === null ? "" : `\n[MORE_AVAILABLE next_offset=${nextOffset}]`),
      };'''
if old_read_tool not in tools:
    raise RuntimeError("read_file tool block not found")
tools = tools.replace(old_read_tool, new_read_tool, 1)
write("src/llm/tools.ts", tools)

# ---------------------------------------------------------------------------
# Correct Google request shape, all images, and flushed SSE (OM-015, 022, 024).
# ---------------------------------------------------------------------------
google = read("src/llm/google.ts")
# Loop through every unique image instead of only screenshot.
old_google_image = re.compile(r'      if \(context\.screenshot\) \{.*?\n      \}', re.S)
new_google_image = r'''      const images = [...new Set([context.screenshot, ...(context.attachments || [])].filter((value): value is string => !!value))];
      for (const image of images) {
        const mimeMatch = image.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
        const mimeType = mimeMatch?.[1] || "image/png";
        const base64Data = image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
        parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
      }'''
google, count = old_google_image.subn(new_google_image, google, count=1)
if count != 1:
    raise RuntimeError("Google image block not found")
old_thinking = '''  if (thinkingLevel) {
    body.thinkingConfig = { thinkingLevel };
  }'''
new_thinking = '''  if (thinkingLevel) {
    if (model.startsWith("gemini-3")) {
      generationConfig.thinkingConfig = { thinkingLevel };
    } else if (model.startsWith("gemini-2.5")) {
      const budget = thinkingLevel === "none" ? 0 : thinkingLevel === "low" ? 1024 : thinkingLevel === "medium" ? 4096 : 8192;
      generationConfig.thinkingConfig = { thinkingBudget: budget };
    }
  }'''
if old_thinking not in google:
    raise RuntimeError("Google thinking block not found")
google = google.replace(old_thinking, new_thinking, 1)
# Flush decoder and a final SSE record by appending a newline to the pending buffer.
google = google.replace(
    '    onDone({ content: fullContent, truncated });',
    '''    buffer += decoder.decode();
    if (buffer.trim()) {
      const finalLine = buffer.trim();
      const data = finalLine.startsWith("data: ") ? finalLine.slice(6).trim() : "";
      if (data) {
        try {
          const parsed = JSON.parse(data);
          const parts = parsed.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (typeof part?.text === "string") { fullContent += part.text; onChunk(part.text); }
          }
          if (parsed.candidates?.[0]?.finishReason === "MAX_TOKENS") truncated = true;
        } catch {}
      }
    }
    onDone({ content: fullContent, truncated });''',
    1,
)
write("src/llm/google.ts", google)

# Best-effort multi-image upgrade for OpenAI/Anthropic builders without changing
# their public signatures. Both files had a single screenshot block.
for path in ["src/llm/openai.ts", "src/llm/anthropic.ts"]:
    content = read(path)
    if "function contextImages(" not in content:
        insertion = '''\nfunction contextImages(context: LlmContext): string[] {\n  return [...new Set([context.screenshot, ...(context.attachments || [])].filter((value): value is string => !!value))];\n}\n'''
        first_export = content.find("export function")
        if first_export < 0:
            raise RuntimeError(f"No export function in {path}")
        content = content[:first_export] + insertion + content[first_export:]
    # Replace the first single-screenshot conditional and references in that block.
    match = re.search(r'if \(context\.screenshot\) \{(.*?)\n\s*\}', content, re.S)
    if match:
        body = match.group(1).replace("context.screenshot", "image")
        replacement = 'for (const image of contextImages(context)) {' + body + '\n      }'
        content = content[:match.start()] + replacement + content[match.end():]
    write(path, content)

# ---------------------------------------------------------------------------
# Proxy preserves API errors and never corrupts encoded HTML (OM-014, OM-030).
# ---------------------------------------------------------------------------
write("src/proxy.ts", r'''
import http from "node:http";
import httpProxy from "http-proxy";
import { getSessionToken } from "./security.js";
import { attachOpenMagic } from "./server.js";

export function createProxyServer(targetHost: string, targetPort: number, roots: string[]): http.Server {
  const proxy = httpProxy.createProxyServer({
    target: `http://${targetHost}:${targetPort}`,
    selfHandleResponse: true,
    changeOrigin: true,
  });
  const token = getSessionToken();

  proxy.on("proxyReq", (proxyReq, req) => {
    const accept = req.headers.accept || "";
    if (accept.includes("text/html")) proxyReq.removeHeader("Accept-Encoding");
  });

  proxy.on("proxyRes", (proxyRes, _req, res) => {
    const contentType = String(proxyRes.headers["content-type"] || "");
    const isHtml = contentType.includes("text/html");
    const status = proxyRes.statusCode || 200;
    const encoding = String(proxyRes.headers["content-encoding"] || "").toLowerCase();

    // API/XHR/static responses — including 4xx/5xx — must remain byte-for-byte
    // compatible with the application. Never turn JSON validation errors into HTML.
    if (!isHtml || encoding) {
      res.writeHead(status, proxyRes.headers);
      proxyRes.on("error", () => { try { res.end(); } catch {} });
      proxyRes.pipe(res);
      return;
    }

    const headers = { ...proxyRes.headers };
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    delete headers["x-content-security-policy"];
    delete headers.etag;
    delete headers["last-modified"];
    headers["cache-control"] = "no-store";

    res.writeHead(status, headers);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      try { res.end(buildInjectionScript(token)); } catch {}
    };
    proxyRes.on("error", finish);
    proxyRes.pipe(res, { end: false });
    proxyRes.on("end", finish);
  });

  proxy.on("error", (error, _req, res) => {
    if (res instanceof http.ServerResponse && !res.headersSent) {
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      res.writeHead(502, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      res.end(`<html><body style="font-family:system-ui;padding:40px;background:#1a1a2e;color:#e0e0e0;">
        <h2 style="color:#e94560;">OpenMagic — Cannot connect to dev server</h2>
        <p>Could not reach <code>${escape(`${targetHost}:${targetPort}`)}</code></p>
        <p style="color:#888;">Make sure your dev server is running, then refresh this page.</p>
        <p style="color:#666;font-size:13px;">${escape(error.message)}</p>
        ${buildInjectionScript(token)}
      </body></html>`);
    } else if (res && typeof (res as { destroy?: () => void }).destroy === "function") {
      try { (res as { destroy: () => void }).destroy(); } catch {}
    }
  });

  let omHandle: ((req: http.IncomingMessage, res: http.ServerResponse) => boolean) | null = null;
  let omUpgrade: ((req: http.IncomingMessage, socket: unknown, head: Buffer) => boolean) | null = null;
  const server = http.createServer((req, res) => {
    if (omHandle?.(req, res)) return;
    proxy.web(req, res);
  });
  const om = attachOpenMagic(server, roots);
  omHandle = om.handleRequest;
  omUpgrade = om.handleUpgrade;
  server.on("upgrade", (req, socket, head) => {
    if (omUpgrade?.(req, socket, head)) return;
    proxy.ws(req, socket, head);
  });
  return server;
}

export function buildInjectionScript(_token: string): string {
  return `<script data-openmagic-warning="true">(function(){queueMicrotask(function(){try{var scripts=[].slice.call(document.scripts||[]);var third=scripts.filter(function(s){if(!s.src)return false;var u=new URL(s.src,location.href);return u.origin!==location.origin&&!u.pathname.startsWith("/__openmagic__/");});if(third.length){console.warn("OpenMagic runs inside this local page. Avoid using it with untrusted third-party scripts.");}}catch(e){}});})();</script><script src="/__openmagic__/toolbar.js?v=${Date.now()}" data-openmagic="true" defer></script>`;
}
''')

# ---------------------------------------------------------------------------
# Screenshot cloning keeps text nodes (OM-023).
# ---------------------------------------------------------------------------
capture = read("src/toolbar/services/capture.ts")
old_children = '''    // Clone children with depth limit
    for (let i = 0; i < source.children.length && i < 20; i++) {
      const child = cloneWithStyles(source.children[i] as HTMLElement, depth + 1, maxDepth);
      if (child) clone.appendChild(child);
    }'''
new_children = '''    // Clone element AND text nodes. Iterating `children` discarded the visible
    // text of headings, buttons, labels and paragraphs from screenshots.
    let cloned = 0;
    for (const node of Array.from(source.childNodes)) {
      if (cloned >= 40) break;
      if (node.nodeType === Node.TEXT_NODE) {
        clone.appendChild(document.createTextNode(node.textContent || ""));
        cloned++;
      } else if (node instanceof HTMLElement) {
        const child = cloneWithStyles(node, depth + 1, maxDepth);
        if (child) { clone.appendChild(child); cloned++; }
      }
    }'''
if old_children not in capture:
    raise RuntimeError("Screenshot clone block not found")
capture = capture.replace(old_children, new_children, 1)
write("src/toolbar/services/capture.ts", capture)

# ---------------------------------------------------------------------------
# Static SPA fallback and framework grounding fixes (OM-031, OM-032).
# ---------------------------------------------------------------------------
static_server = read("src/static-server.ts")
static_server = static_server.replace('import { extname, relative, resolve } from "node:path";', 'import { existsSync } from "node:fs";\nimport { extname, relative, resolve } from "node:path";')
static_server = static_server.replace(
    '  return candidate;\n}',
    '''  if (!existsSync(candidate) && !extname(pathname)) {
    const fallback = resolve(root, "index.html");
    if (existsSync(fallback)) return fallback;
  }
  return candidate;
}''',
    1,
)
write("src/static-server.ts", static_server)

ground = read("src/project-grounding.ts")
ground = ground.replace(
    'const TEXT_RE = /\\.(?:[cm]?[jt]sx?|json|svelte|vue|astro|html?|css|scss|less|php|py|rb|blade\\.php)$/i;',
    'const TEXT_RE = /\\.(?:[cm]?[jt]sx?|json|jsonc|mdx?|graphql|gql|prisma|sql|go|java|kt|cs|rs|svelte|vue|astro|html?|css|scss|less|php|py|rb|twig|erb|blade\\.php)$/i;',
)
ground = ground.replace(
    '  if (deps.vue || existsSync(join(root, "vite.config.ts"))) return deps.react ? "vite-react" : "vue";\n  if (deps.react || existsSync(join(root, "src/App.tsx")) || existsSync(join(root, "src/App.jsx"))) return "vite-react";',
    '  if (deps.vue) return "vue";\n  if (deps.react || existsSync(join(root, "src/App.tsx")) || existsSync(join(root, "src/App.jsx"))) return "vite-react";\n  if (deps.vite || existsSync(join(root, "vite.config.ts")) || existsSync(join(root, "vite.config.js"))) return "vite";',
)
# Add multi-root merger before detectFramework.
marker = 'export function detectFramework(root: string): string {'
merge_code = r'''
export function groundProjects(roots: string[], request: ProjectGroundRequest): ProjectGroundResult {
  if (roots.length <= 1) return groundProject(roots[0] || process.cwd(), request);
  const { basename } = require("node:path") as typeof import("node:path");
  const aliases = new Map<string, number>();
  for (const root of roots) aliases.set(basename(root), (aliases.get(basename(root)) || 0) + 1);
  const results = roots.map((root, index) => {
    const alias = aliases.get(basename(root)) === 1 ? basename(root) : `root-${index + 1}`;
    return { alias, result: groundProject(root, request) };
  });
  const files = results.flatMap(({ alias, result }) => result.files.map((file) => ({ ...file, path: `${alias}/${file.path}`, reasons: [`project ${alias}`, ...file.reasons] })));
  const rankedFiles = files.map((file) => ({ path: file.path, reasons: file.reasons, score: file.score, snippet: file.content.slice(0, 400) }));
  return {
    framework: results.map(({ alias, result }) => `${alias}:${result.framework}`).join(", "),
    conventions: results.map(({ alias, result }) => `[${alias}]\n${result.conventions}`).join("\n\n"),
    files: files.sort((a, b) => b.score - a.score).slice(0, 10),
    rankedFiles: rankedFiles.sort((a, b) => b.score - a.score).slice(0, 10),
  };
}

'''
# Avoid require in ESM by adding basename import instead.
ground = ground.replace('import { dirname, join, relative } from "node:path";', 'import { basename, dirname, join, relative } from "node:path";')
merge_code = merge_code.replace('  const { basename } = require("node:path") as typeof import("node:path");\n', '')
if marker not in ground:
    raise RuntimeError("Grounding insertion marker missing")
ground = ground.replace(marker, merge_code + marker, 1)
write("src/project-grounding.ts", ground)

# ---------------------------------------------------------------------------
# Server routing: provider keys, root-aware FS/patch/verify/grounding.
# ---------------------------------------------------------------------------
server = read("src/server.ts")
server = server.replace('import { loadConfig, saveConfig } from "./config.js";', 'import { getProviderApiKey, hasProviderApiKey, loadConfig, saveConfig } from "./config.js";')
server = server.replace('import { groundProject, type ProjectGroundRequest } from "./project-grounding.js";', 'import { groundProjects, type ProjectGroundRequest } from "./project-grounding.js";')
server = server.replace(
    'import { applyPatchGroup, previewPatchGroup, pruneOldManifests, rollbackChain, rollbackPatchGroup, type PatchGroupRequest } from "./patch.js";',
    'import { pruneOldManifests, type PatchGroupRequest } from "./patch.js";\nimport { applyPatchGroupAcrossRoots, previewPatchGroupAcrossRoots, rollbackPatchGroupAcrossRoots } from "./multi-root-patch.js";\nimport { displayPathFor, resolveProjectPath } from "./root-resolver.js";',
)
server = server.replace('hasApiKey: !!config.apiKey,', 'hasApiKey: hasProviderApiKey(config, config.provider || ""),')
server = server.replace('const apiKey = config.apiKeys?.[provider] || config.apiKey || "";', 'const apiKey = getProviderApiKey(config, provider);')
server = server.replace('const apiKey = config.apiKeys?.[provider] || config.apiKey || "";', 'const apiKey = getProviderApiKey(config, provider);')
server = server.replace('const apiKey = config.apiKeys?.[provider] || config.apiKey || "";', 'const apiKey = getProviderApiKey(config, provider);')
server = server.replace('hasApiKey: !!(config.apiKeys?.[provider] || config.apiKey),', 'hasApiKey: hasProviderApiKey(config, provider),')
server = server.replace('const apiKey = config.apiKeys?.[provider] || config.apiKey || "";', 'const apiKey = getProviderApiKey(config, provider);')
server = server.replace('const apiKey = config.apiKeys?.[provider] || config.apiKey || "";', 'const apiKey = getProviderApiKey(config, provider);')
server = server.replace('        updates.apiKey = payload.apiKey; // backward compat\n', '')
server = server.replace('        updates.apiKey = payload.apiKey;\n', '')

# Resolve direct filesystem operations against every configured root.
server = server.replace(
    '      const result = readFileSafe(payload.path, roots);',
    '      const resolved = resolveProjectPath(payload.path, roots, { mustExist: true });\n      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }\n      const result = readFileSafe(resolved.absolutePath, [resolved.root]);',
)
server = server.replace(
    '          payload: { path: payload.path, content: result.content },',
    '          payload: { path: resolved.displayPath, content: result.content },',
    1,
)
server = server.replace(
    '      const writeResult = writeFileSafe(payload.path, payload.content, roots);',
    '      const resolved = resolveProjectPath(payload.path, roots, { forCreate: true });\n      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }\n      const writeResult = writeFileSafe(resolved.absolutePath, payload.content, [resolved.root]);',
)
server = server.replace(
    '      const deleteResult = deleteFileSafe(payload.path, roots);',
    '      const resolved = resolveProjectPath(payload.path, roots, { mustExist: false });\n      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }\n      const deleteResult = deleteFileSafe(resolved.absolutePath, [resolved.root]);',
)
server = server.replace(
    '      const undoResult = undoFileSafe(payload.path, roots);',
    '      const resolved = resolveProjectPath(payload.path, roots, { mustExist: false });\n      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }\n      const undoResult = undoFileSafe(resolved.absolutePath, [resolved.root]);',
)
server = server.replace('previewPatchGroup(roots[0] || process.cwd(), payload)', 'previewPatchGroupAcrossRoots(roots, payload)')
server = server.replace('applyPatchGroup(roots[0] || process.cwd(), payload)', 'applyPatchGroupAcrossRoots(roots, payload)')
old_rb = '''      const root = roots[0] || process.cwd();
      const result = payload.chain
        ? rollbackChain(root, payload.groupId)
        : rollbackPatchGroup(root, payload.groupId);'''
new_rb = '''      const result = rollbackPatchGroupAcrossRoots(roots, payload.groupId, payload.chain === true);'''
if old_rb not in server:
    raise RuntimeError("Server rollback block not found")
server = server.replace(old_rb, new_rb, 1)
server = server.replace('verifyPatchGroup(roots[0] || process.cwd(), {', 'verifyPatchGroup(roots, {')

# Combined file listing uses explicit root aliases.
list_pattern = re.compile(r'    case "fs\.list": \{.*?\n      break;\n    \}', re.S)
list_replacement = r'''    case "fs.list": {
      const payload = msg.payload as FsListPayload | undefined;
      if (payload?.root) {
        const resolved = resolveProjectPath(payload.root, roots, { mustExist: true });
        if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
        const files = listFiles(resolved.absolutePath, [resolved.root]);
        send(ws, { id: msg.id, type: "fs.tree", payload: { files, projectTree: getProjectTree(roots) } });
        break;
      }
      const files = roots.flatMap((root) => listFiles(root, [root]).map((file) => ({
        ...file,
        path: displayPathFor(root, file.path, roots),
      })));
      send(ws, { id: msg.id, type: "fs.tree", payload: { files, projectTree: getProjectTree(roots) } });
      break;
    }'''
server, count = list_pattern.subn(list_replacement, server, count=1)
if count != 1:
    raise RuntimeError("Server fs.list case not found")
server = server.replace('const result = groundProject(roots[0] || process.cwd(), payload || {});', 'const result = groundProjects(roots, payload || {});')
# Pass all roots to LLM orchestration.
server = server.replace('          root: roots[0],\n', '          root: roots[0],\n          roots,\n', 1)
server = server.replace('{ provider, model, apiKey, messages: payload.messages, context: ctx, useTools:', '{ provider, model, apiKey, messages: payload.messages, context: ctx, roots, useTools:')
# Root-aware agent reads/searches.
server = server.replace(
    '''            readFile: async (p) => {
              const r = readFileSafe(join(root, p), roots);
              return "error" in r ? null : r.content.slice(0, 16000);
            },
            search: async (q) => grepFiles(q, root, roots).map((m) => `${m.file}:${m.lineNum}: ${m.line}`).join("\\n"),''',
    '''            readFile: async (p) => {
              const resolved = resolveProjectPath(p, roots, { mustExist: true });
              if ("error" in resolved) return null;
              const r = readFileSafe(resolved.absolutePath, [resolved.root]);
              return "error" in r ? null : r.content.slice(0, 16000);
            },
            search: async (q) => roots.flatMap((candidate) =>
              grepFiles(q, candidate, [candidate]).map((m) => `${displayPathFor(candidate, m.file, roots)}:${m.lineNum}: ${m.line}`)
            ).join("\\n"),''',
)
write("src/server.ts", server)

# ---------------------------------------------------------------------------
# CLI process ownership, cross-platform spawn, port validation (OM-002..005,019).
# ---------------------------------------------------------------------------
write("src/process-management.ts", r'''
import { isAbsolute, relative, resolve, sep } from "node:path";

export function parsePort(value: string | number, label = "port"): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

export function isSameOrNestedPath(candidate: string, expected: string): boolean {
  const rel = relative(resolve(expected), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function platformCommand(command: string, platform = process.platform): string {
  if (platform === "win32" && ["npm", "npx", "pnpm", "yarn", "bun"].includes(command)) return `${command}.cmd`;
  return command;
}
''')

cli = read("src/cli.ts")
cli = cli.replace('import { resolve, join } from "node:path";', 'import { resolve, join } from "node:path";\nimport { parsePort, platformCommand } from "./process-management.js";')
cli = cli.replace('let lastDetectedPort: number | null = null; // Port detected from dev server output', 'let lastDetectedPort: number | null = null; // Port detected from dev server output\nlet ownsTargetProcess = false;')
# A responding HTTP server is alive regardless of route status.
cli = cli.replace('resolve(res.statusCode !== undefined && res.statusCode < 400);', 'resolve(res.statusCode !== undefined);')
# Cross-platform direct command execution.
cli = cli.replace('        shell: "/bin/sh",', '        shell: false,')
cli = cli.replace('      const child = spawn(cmd, args, {', '      const child = spawn(platformCommand(cmd), args, {', 1)
# Parse/validate ports.
cli = cli.replace('      targetPort = parseInt(opts.port, 10);', '      try { targetPort = parsePort(opts.port, "Dev server port"); } catch (error) { printError((error as Error).message); process.exit(1); }')
cli = cli.replace('    const requestedProxyPort = parseInt(opts.listen, 10);', '    let requestedProxyPort: number;\n    try { requestedProxyPort = parsePort(opts.listen, "OpenMagic proxy port"); } catch (error) { printError((error as Error).message); process.exit(1); }')
# Direct child spawn instead of `sh -c`; set ownership only for spawned servers.
spawn_block = re.compile(r'    // Wrap in shell with ulimit.*?child = spawn\("sh", \["-c", shellCmd\], \{\n      cwd: process\.cwd\(\),\n      stdio: "inherit",\n      env: \{', re.S)
spawn_repl = '''    child = spawn(platformCommand(runCmd), runArgs, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
      env: {'''
cli, count = spawn_block.subn(spawn_repl, cli, count=1)
if count != 1:
    raise RuntimeError("CLI shell spawn block not found")
# Mark owned after child registration; static child too.
cli = cli.replace('  childProcesses.push(child);\n  let childExited = false;', '  childProcesses.push(child);\n  ownsTargetProcess = true;\n  let childExited = false;', 1)
cli = cli.replace('      childProcesses.push(staticChild);', '      childProcesses.push(staticChild);\n      ownsTargetProcess = true;', 1)
# Never kill an external/detected server.
cli = cli.replace('      if (targetPort) {\n        killPortProcess(targetPort);\n      }', '      if (targetPort && ownsTargetProcess) {\n        killPortProcess(targetPort);\n      }', 1)
cli = cli.replace('      if (targetPort && (await isPortOpen(targetPort))) {', '      if (targetPort && ownsTargetProcess && (await isPortOpen(targetPort))) {', 1)
write("src/cli.ts", cli)

# Ownership matching in detect.ts uses path boundaries rather than startsWith.
detect = read("src/detect.ts")
detect = detect.replace('import { join, resolve } from "node:path";', 'import { join, resolve } from "node:path";\nimport { isSameOrNestedPath } from "./process-management.js";')
detect = detect.replace(
    '        if (processCwd === expected || expected.startsWith(processCwd) || processCwd.startsWith(expected)) {',
    '        if (isSameOrNestedPath(processCwd, expected) || isSameOrNestedPath(expected, processCwd)) {',
)
write("src/detect.ts", detect)

# ---------------------------------------------------------------------------
# Visual editor mutates only a direct text node; discard preserves descendants.
# OM-013. Runtime smoke observes for longer and verify errors still arm it.
# ---------------------------------------------------------------------------
toolbar = read("src/toolbar/index.ts")
toolbar = toolbar.replace(
    '  editorRevert: null as { attrs: Record<string, string>; text: string } | null, // for Discard',
    '  editorRevert: null as { attrs: Record<string, string>; textNode: Text | null; text: string; customProps: Set<string> } | null, // for Discard',
)
toolbar = toolbar.replace(
    '  state.editorRevert = { attrs, text: el.textContent || "" };',
    '  const textNode = Array.from(el.childNodes).find((node): node is Text => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()) || null;\n  state.editorRevert = { attrs, textNode, text: textNode?.nodeValue || "", customProps: new Set<string>() };',
)
regex_live = re.compile(r'function applyLiveEdit\(target: HTMLElement\): void \{.*?\n\}', re.S)
new_live = r'''function applyLiveEdit(target: HTMLElement): void {
  const el = state.editTargetEl;
  const snap = state.editorRevert;
  if (!el || !snap) return;
  const value = (target as HTMLInputElement | HTMLTextAreaElement).value;
  if (target.dataset.editStyle) {
    if (value.trim()) el.style.setProperty(target.dataset.editStyle, value);
    else el.style.removeProperty(target.dataset.editStyle);
  } else if (target.dataset.editText !== undefined) {
    // Never assign container.textContent: that destroys descendant elements and
    // their listeners. Edit the existing direct text node only.
    if (snap.textNode?.parentNode === el) snap.textNode.nodeValue = value;
  } else if (target.dataset.editClass !== undefined) {
    el.className = value;
  } else if (target.dataset.editAttr) {
    if (value) el.setAttribute(target.dataset.editAttr, value);
    else el.removeAttribute(target.dataset.editAttr);
  } else if (target.dataset.editCustomCss !== undefined) {
    for (const prop of snap.customProps) el.style.removeProperty(prop);
    snap.customProps.clear();
    for (const decl of value.split(";")) {
      const idx = decl.indexOf(":");
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim();
      const val = decl.slice(idx + 1).trim();
      if (prop && val) { el.style.setProperty(prop, val); snap.customProps.add(prop); }
    }
  }
}'''
toolbar, count = regex_live.subn(new_live, toolbar, count=1)
if count != 1:
    raise RuntimeError("Visual live-edit function not found")
regex_revert = re.compile(r'function revertElementEdits\(\): void \{.*?\n\}', re.S)
new_revert = r'''function revertElementEdits(): void {
  const el = state.editTargetEl;
  const snap = state.editorRevert;
  if (el && snap) {
    for (const attribute of Array.from(el.attributes)) el.removeAttribute(attribute.name);
    for (const [name, value] of Object.entries(snap.attrs)) {
      try { el.setAttribute(name, value); } catch {}
    }
    if (snap.textNode?.parentNode === el) snap.textNode.nodeValue = snap.text;
  }
  state.editTargetEl = null;
  state.editorOriginal = null;
  state.editorRevert = null;
  $host?.setAttribute("data-openmagic-editing", "");
}'''
toolbar, count = regex_revert.subn(new_revert, toolbar, count=1)
if count != 1:
    raise RuntimeError("Visual revert function not found")
toolbar = toolbar.replace(
    '<label class="om-edit-row"><span class="om-edit-label">text</span><input class="om-edit-input" data-edit-text value="${escapeHtml(s.text.slice(0, 200))}" /></label>',
    '<label class="om-edit-row"><span class="om-edit-label">text</span><input class="om-edit-input" data-edit-text value="${escapeHtml(state.editorRevert?.text || "")}" ${state.editorRevert?.textNode ? "" : "disabled title=\\"This element has no direct editable text node\\""} /></label>',
)
# Verification transport failure still arms post-reload runtime checking.
toolbar = toolbar.replace(
    '''  } catch {
    reload(); // verification itself couldn't run — don't block the edit
    return;
  }''',
    '''  } catch {
    armRuntimeCheck();
    state.messages.push({ role: "system", content: "Build verification could not run; keeping the edit provisionally and running the browser runtime smoke check after reload." });
    reload();
    return;
  }''',
    1,
)
# Observe runtime for five seconds instead of one fixed instant.
toolbar = toolbar.replace(
    '''  // Let the freshly-reloaded app render and throw before we look.
  await new Promise((r) => setTimeout(r, 1500));

  const failure = summarizeRuntimeFailure(scrapeErrorOverlay(), getRuntimeErrors());
  if (!failure) return; // healthy at runtime — nothing to do''',
    '''  // Observe a short window: hydration and lazy effects often fail after the
  // first paint rather than at one fixed 1.5-second instant.
  let failure = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    failure = summarizeRuntimeFailure(scrapeErrorOverlay(), getRuntimeErrors());
    if (failure) break;
  }
  if (!failure) return;''',
    1,
)
write("src/toolbar/index.ts", toolbar)

# ---------------------------------------------------------------------------
# Website version consistency (OM-033).
# ---------------------------------------------------------------------------
docs = read("docs/index.html").replace('v0.31.1', 'v0.44.2')
write("docs/index.html", docs)

# ---------------------------------------------------------------------------
# Regression tests for the repaired contracts.
# ---------------------------------------------------------------------------
write("tests/audit-regressions.test.ts", r'''
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderApiKey } from "../src/config.js";
import { resolveProjectPath } from "../src/root-resolver.js";
import { readFileSafe, writeFileSafe } from "../src/filesystem.js";
import { buildGoogleRequest } from "../src/llm/google.js";
import { executeServerTool } from "../src/llm/tools.js";
import { createNativeEditSession, captureNativeEditSession, closeNativeEditSession } from "../src/llm/native-capture.js";
import { resolveStaticRequestPath } from "../src/static-server.js";
import { detectVerifyScripts } from "../src/verify.js";

const dirs: string[] = [];
const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("full audit regressions", () => {
  it("never falls back to another provider's key", () => {
    const config = { provider: "openai", apiKey: "legacy", apiKeys: { openai: "sk-openai" } };
    expect(getProviderApiKey(config, "openai")).toBe("sk-openai");
    expect(getProviderApiKey(config, "anthropic")).toBe("");
  });

  it("resolves explicit and existing paths across multiple roots", () => {
    const a = temp("om-root-a-");
    const b = temp("om-root-b-");
    mkdirSync(join(b, "src"));
    writeFileSync(join(b, "src", "App.tsx"), "export {}\n");
    const found = resolveProjectPath("src/App.tsx", [a, b], { mustExist: true });
    expect("error" in found).toBe(false);
    if (!("error" in found)) expect(found.root).toBe(b);
  });

  it("preserves executable mode across atomic writes", () => {
    if (process.platform === "win32") return;
    const root = temp("om-mode-");
    const file = join(root, "script.sh");
    writeFileSync(file, "#!/bin/sh\necho before\n");
    chmodSync(file, 0o755);
    expect(writeFileSafe(file, "#!/bin/sh\necho after\n", [root]).ok).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o755);
  });

  it("refuses to replace symbolic links", () => {
    if (process.platform === "win32") return;
    const root = temp("om-symlink-");
    const target = join(root, "target.txt");
    const link = join(root, "link.txt");
    writeFileSync(target, "safe");
    execFileSync("ln", ["-s", target, link]);
    const result = writeFileSafe(link, "changed", [root]);
    expect(result.ok).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("safe");
  });

  it("returns exact paged file chunks", () => {
    const root = temp("om-page-");
    writeFileSync(join(root, "large.txt"), "0123456789abcdef");
    const result = executeServerTool("read_file", { path: "large.txt", offset: 4, limit: 6 }, root, [root]);
    expect(result.content).toContain("456789");
    expect(result.content).toContain("next_offset=10");
  });

  it("puts Google thinking config inside generationConfig and includes every image", () => {
    const body: any = buildGoogleRequest("gemini-3.1-pro-preview", [{ role: "user", content: "change it" }], {
      screenshot: "data:image/png;base64,AAA",
      attachments: ["data:image/jpeg;base64,BBB"],
      reasoningLevel: "high",
    });
    expect(body.thinkingConfig).toBeUndefined();
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBeTruthy();
    const inline = body.contents[0].parts.filter((part: any) => part.inline_data);
    expect(inline).toHaveLength(2);
  });

  it("serves index.html as an SPA fallback for extensionless routes", () => {
    const root = temp("om-spa-");
    writeFileSync(join(root, "index.html"), "<main>app</main>");
    expect(resolveStaticRequestPath(root, "/dashboard/settings")).toBe(join(root, "index.html"));
  });

  it("detects every configured verification gate", () => {
    const root = temp("om-verify-");
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc", lint: "eslint .", check: "test -f package.json" } }));
    expect(detectVerifyScripts(root)).toEqual(["typecheck", "lint", "check"]);
  });

  it("runs native edits in an isolated worktree and leaves the source checkout untouched", () => {
    const root = temp("om-native-");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "before\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root });
    const session = createNativeEditSession(root);
    try {
      writeFileSync(join(session.workspace, "file.txt"), "after\n");
      const mods = captureNativeEditSession(session);
      expect(mods).toHaveLength(1);
      expect(readFileSafe(join(root, "file.txt"), [root])).toEqual({ content: "before\n" });
    } finally {
      closeNativeEditSession(session);
    }
    expect(existsSync(join(root, ".git"))).toBe(true);
  });
});
''')

# Replace the old destructive native-capture tests with the new contract.
write("tests/native-capture.test.ts", r'''
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
''')

# Add cross-platform non-browser validation to CI.
ci = read(".github/workflows/ci.yml")
if "cross-platform:" not in ci:
    ci += r'''

  cross-platform:
    strategy:
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run test:smoke
'''
write(".github/workflows/ci.yml", ci)

print("Full audit fix transformation completed")
