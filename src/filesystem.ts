import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  lstatSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join, resolve, relative, dirname, extname } from "node:path";
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

  // Also check realpath to prevent symlink escape
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    // File doesn't exist yet (for writes) — use resolved path
    real = resolved;
  }

  return roots.some((root) => {
    const resolvedRoot = resolve(root);
    const rel = relative(resolvedRoot, resolved);
    const realRel = relative(resolvedRoot, real);
    return (
      (!rel.startsWith("..") && !rel.startsWith("/") && !rel.startsWith("\\")) &&
      (!realRel.startsWith("..") && !realRel.startsWith("/") && !realRel.startsWith("\\"))
    );
  });
}

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
    const content = readFileSync(filePath, "utf-8");
    return { content };
  } catch (e: unknown) {
    return { error: `Failed to read file: ${(e as Error).message}` };
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
    // Create backup
    let backupPath: string | undefined;
    if (existsSync(filePath)) {
      backupPath = filePath + ".openmagic-backup";
      copyFileSync(filePath, backupPath);
    }

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, content, "utf-8");
    return { ok: true, backupPath };
  } catch (e: unknown) {
    return { ok: false, error: `Failed to write file: ${(e as Error).message}` };
  }
}

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
    if (depth > maxDepth) return;

    let items: string[];
    try {
      items = readdirSync(dir);
    } catch {
      return;
    }

    for (const item of items) {
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
