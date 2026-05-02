import {
  readFileSync,
  existsSync,
  statSync,
  lstatSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
  rmSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join, resolve, relative, dirname, extname, parse } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { FileEntry } from "./shared-types.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "build",
  ".cache",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  ".DS_Store",
]);

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".lock",
]);

export function isPathSafe(filePath: string, roots: string[]): boolean {
  const resolved = resolve(filePath);

  return roots.some((root) => {
    const resolvedRoot = resolve(root);
    let realRoot: string;
    try {
      realRoot = realpathSync(resolvedRoot);
    } catch {
      return false;
    }

    const rel = relative(resolvedRoot, resolved);
    if (isOutsideRelative(rel)) return false;

    const existingPath = nearestExistingPath(resolved);
    if (!existingPath) return false;

    let real: string;
    try {
      real = realpathSync(existingPath);
    } catch {
      return false;
    }

    const realRel = relative(realRoot, real);
    return !isOutsideRelative(realRel);
  });
}

function isOutsideRelative(relPath: string): boolean {
  return relPath === ".." ||
    relPath.startsWith(`..${"/"}`) ||
    relPath.startsWith(`..${"\\"}`) ||
    relPath.startsWith("/") ||
    relPath.startsWith("\\");
}

function nearestExistingPath(filePath: string): string | null {
  let current = resolve(filePath);
  const root = parse(current).root;

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current || current === root) return null;
    current = parent;
  }

  return current;
}

// Track line endings and BOM per file so writeFileSafe can restore them
const fileMetadata = new Map<string, { hasBOM: boolean; lineEnding: string }>();

export function readFileSafe(
  filePath: string,
  roots: string[]
): { content: string } | { error: string } {
  if (!isPathSafe(filePath, roots)) {
    return { error: "Path is outside allowed roots" };
  }
  if (!existsSync(filePath)) {
    return { error: "File not found" };
  }
  try {
    const raw = readFileSync(filePath);
    // Detect BOM (UTF-8: EF BB BF)
    const hasBOM = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
    let content = hasBOM ? raw.subarray(3).toString("utf-8") : raw.toString("utf-8");
    // Detect and normalize line endings
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
    if (lineEnding === "\r\n") content = content.replace(/\r\n/g, "\n");
    // Store metadata for write restoration
    fileMetadata.set(resolve(filePath), { hasBOM, lineEnding });
    return { content };
  } catch (e: unknown) {
    return { error: `Failed to read file: ${(e as Error).message}` };
  }
}

// ── Backup Management (temp directory) ──
const BACKUP_DIR = join(tmpdir(), "openmagic-backups");
const MAX_BACKUPS_PER_FILE = 10;
type BackupEntry = { backupPath?: string; existed: boolean };
const backupStack = new Map<string, BackupEntry[]>(); // originalPath -> newest backup stack

function getBackupPath(filePath: string): string {
  const hash = createHash("md5").update(resolve(filePath)).digest("hex").slice(0, 12);
  const name = filePath.split(/[/\\]/).pop() || "file";
  const unique = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return join(BACKUP_DIR, `${hash}_${unique}_${name}`);
}

export function getBackupForFile(filePath: string): string | undefined {
  const stack = backupStack.get(resolve(filePath));
  return stack?.[stack.length - 1]?.backupPath;
}

export function getUndoCountForFile(filePath: string): number {
  return backupStack.get(resolve(filePath))?.length || 0;
}

export function cleanupBackups(): void {
  try {
    if (existsSync(BACKUP_DIR)) {
      rmSync(BACKUP_DIR, { recursive: true, force: true });
    }
  } catch {}
  backupStack.clear();
}

function pushBackup(filePath: string, entry: BackupEntry): string | undefined {
  const key = resolve(filePath);
  const stack = backupStack.get(key) || [];
  stack.push(entry);
  while (stack.length > MAX_BACKUPS_PER_FILE) {
    const old = stack.shift();
    if (old?.backupPath) {
      try { unlinkSync(old.backupPath); } catch {}
    }
  }
  backupStack.set(key, stack);
  return entry.backupPath;
}

function createBackupEntry(filePath: string): BackupEntry {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  if (!existsSync(filePath)) {
    return { existed: false };
  }
  const backupPath = getBackupPath(filePath);
  copyFileSync(filePath, backupPath);
  return { existed: true, backupPath };
}

function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch {
    // Best effort on platforms that do not support opening directories.
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
}

function atomicWriteFile(filePath: string, data: string | Buffer): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = join(dir, `.${parse(filePath).base}.openmagic-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let fd: number | undefined;
  try {
    fd = openSync(tmpPath, "w", 0o600);
    if (Buffer.isBuffer(data)) {
      writeSync(fd, data);
    } else {
      writeSync(fd, data, 0, "utf-8");
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath);
    fsyncDir(dir);
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    try { unlinkSync(tmpPath); } catch {}
    throw error;
  }
}

export function writeFileSafe(
  filePath: string,
  content: string,
  roots: string[]
): { ok: boolean; error?: string; backupPath?: string } {
  if (!isPathSafe(filePath, roots)) {
    return { ok: false, error: "Path is outside allowed roots" };
  }

  try {
    const backupPath = pushBackup(filePath, createBackupEntry(filePath));

    // Restore original line endings and BOM
    let output = content;
    const meta = fileMetadata.get(resolve(filePath));
    if (meta) {
      if (meta.lineEnding === "\r\n") output = output.replace(/\n/g, "\r\n");
      if (meta.hasBOM) output = "\uFEFF" + output;
    }

    atomicWriteFile(filePath, output);
    return { ok: true, backupPath };
  } catch (e: unknown) {
    return { ok: false, error: `Failed to write file: ${(e as Error).message}` };
  }
}

export function deleteFileSafe(
  filePath: string,
  roots: string[]
): { ok: boolean; error?: string } {
  if (!isPathSafe(filePath, roots)) {
    return { ok: false, error: "Path is outside allowed roots" };
  }

  try {
    if (!existsSync(filePath)) {
      return { ok: true };
    }

    const stat = lstatSync(filePath);
    if (!stat.isFile()) {
      return { ok: false, error: "Can only delete regular files" };
    }

    pushBackup(filePath, createBackupEntry(filePath));
    unlinkSync(filePath);
    fsyncDir(dirname(filePath));
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: `Failed to delete file: ${(e as Error).message}` };
  }
}

export function undoFileSafe(
  filePath: string,
  roots: string[]
): { ok: boolean; error?: string; remainingUndoCount?: number } {
  if (!isPathSafe(filePath, roots)) {
    return { ok: false, error: "Path is outside allowed roots" };
  }

  const key = resolve(filePath);
  const stack = backupStack.get(key);
  const entry = stack?.pop();
  if (!entry) {
    return { ok: false, error: "No backup found" };
  }
  if (stack && stack.length === 0) backupStack.delete(key);

  try {
    if (entry.existed) {
      if (!entry.backupPath || !existsSync(entry.backupPath)) {
        return { ok: false, error: "Backup file is missing" };
      }
      const raw = readFileSync(entry.backupPath);
      atomicWriteFile(filePath, raw);
      try { unlinkSync(entry.backupPath); } catch {}
    } else if (existsSync(filePath)) {
      unlinkSync(filePath);
      fsyncDir(dirname(filePath));
    }
    return { ok: true, remainingUndoCount: getUndoCountForFile(filePath) };
  } catch (e: unknown) {
    stack?.push(entry);
    return { ok: false, error: `Undo failed: ${(e as Error).message}` };
  }
}

const MAX_LIST_ENTRIES = 2000;

export function listFiles(
  rootPath: string,
  roots: string[],
  maxDepth: number = 4
): FileEntry[] {
  if (!isPathSafe(rootPath, roots)) {
    return [];
  }

  const entries: FileEntry[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || entries.length >= MAX_LIST_ENTRIES) return;

    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const item of items) {
      if (entries.length >= MAX_LIST_ENTRIES) return;
      if (IGNORED_DIRS.has(item)) continue;
      if (item.startsWith(".") && item !== ".env.example") continue;

      const fullPath = join(dir, item);
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;

      const relPath = relative(rootPath, fullPath);

      if (stat.isDirectory()) {
        entries.push({ path: relPath, type: "dir", name: item });
        walk(fullPath, depth + 1);
      } else if (stat.isFile()) {
        const ext = extname(item).toLowerCase();
        if (!IGNORED_EXTENSIONS.has(ext)) {
          entries.push({ path: relPath, type: "file", name: item });
        }
      }
    }
  }

  walk(rootPath, 0);
  return entries;
}

const GREP_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".vue", ".svelte", ".astro",
  ".html", ".htm", ".css", ".scss", ".less",
  ".json", ".md", ".yaml", ".yml",
  ".php", ".py", ".rb",
]);

const MAX_GREP_FILE_SIZE = 256 * 1024; // 256KB — skip large generated/bundled files
const MAX_GREP_FILES_SCANNED = 500;   // stop walking after scanning this many files

export function grepFiles(
  pattern: string,
  searchRoot: string,
  roots: string[],
  maxResults: number = 30
): { file: string; lineNum: number; line: string }[] {
  if (!isPathSafe(searchRoot, roots)) return [];

  const results: { file: string; lineNum: number; line: string }[] = [];
  const lowerPattern = pattern.toLowerCase();
  let filesScanned = 0;

  function walk(dir: string, depth: number): void {
    if (depth > 6 || results.length >= maxResults || filesScanned >= MAX_GREP_FILES_SCANNED) return;
    let items: string[];
    try { items = readdirSync(dir); } catch { return; }

    for (const item of items) {
      if (results.length >= maxResults || filesScanned >= MAX_GREP_FILES_SCANNED) return;
      if (IGNORED_DIRS.has(item) || (item.startsWith(".") && item !== ".env.example")) continue;

      const fullPath = join(dir, item);
      let stat;
      try { stat = lstatSync(fullPath); } catch { continue; }
      if (stat.isSymbolicLink()) continue;

      if (stat.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (stat.isFile()) {
        const ext = extname(item).toLowerCase();
        if (!GREP_EXTENSIONS.has(ext)) continue;
        if (stat.size > MAX_GREP_FILE_SIZE) continue; // skip large files
        filesScanned++;

        try {
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          let fileMatches = 0;
          for (let i = 0; i < lines.length && fileMatches < 5; i++) {
            if (lines[i].toLowerCase().includes(lowerPattern)) {
              results.push({
                file: relative(searchRoot, fullPath),
                lineNum: i + 1,
                line: lines[i].trim().slice(0, 200),
              });
              fileMatches++;
            }
          }
        } catch {}
      }
    }
  }

  walk(searchRoot, 0);
  return results;
}

export function getProjectTree(roots: string[]): string {
  const lines: string[] = [];
  for (const root of roots) {
    lines.push(`[${root}]`);
    const files = listFiles(root, roots, 3);
    for (const f of files) {
      const indent = f.path.split("/").length - 1;
      const prefix = "  ".repeat(indent);
      const icon = f.type === "dir" ? "/" : "";
      lines.push(`${prefix}${f.name}${icon}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
