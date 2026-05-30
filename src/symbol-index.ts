import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listFiles } from "./filesystem.js";

/**
 * C1: a lightweight codebase symbol index. The dominant edit failure is grounding
 * the wrong/incomplete file; mapping exported symbols → files lets grounding (and
 * the tool loop) resolve a componentHint or prompt term straight to the source.
 *
 * Regex-based (no TS compiler dependency) — fast and good enough to locate
 * exports; it intentionally does not type-check.
 */

export type SymbolKind = "component" | "function" | "class" | "const" | "type" | "interface" | "default";

export interface SymbolEntry {
  name: string;
  file: string; // relative to root
  kind: SymbolKind;
}

export interface SymbolIndex {
  symbols: Map<string, SymbolEntry[]>; // lowercased name → entries
  builtAt: number;
}

const TEXT_RE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro)$/i;
const MAX_FILE_BYTES = 256 * 1024;

function addEntry(symbols: Map<string, SymbolEntry[]>, entry: SymbolEntry): void {
  const key = entry.name.toLowerCase();
  const list = symbols.get(key) || [];
  if (!list.some((e) => e.file === entry.file && e.name === entry.name)) list.push(entry);
  symbols.set(key, list);
}

function isComponentName(name: string, file: string): boolean {
  return /^[A-Z]/.test(name) && /\.(?:[jt]sx|svelte|vue|astro)$/i.test(file);
}

function extractFromFile(content: string, file: string, symbols: Map<string, SymbolEntry[]>): void {
  const add = (name: string, kind: SymbolKind) => {
    if (!name) return;
    addEntry(symbols, { name, file, kind: kind === "const" || kind === "function" || kind === "class"
      ? (isComponentName(name, file) ? "component" : kind)
      : kind });
  };

  // export default function/class Name
  for (const m of content.matchAll(/export\s+default\s+(?:async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    add(m[2], m[1] === "class" ? "class" : "function");
  }
  // export (async) function Name
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) add(m[1], "function");
  // export class Name
  for (const m of content.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(m[1], "class");
  // export const/let/var Name
  for (const m of content.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1], "const");
  // export interface Name
  for (const m of content.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)/g)) add(m[1], "interface");
  // export type Name
  for (const m of content.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)/g)) add(m[1], "type");
  // export { A, B as C } — record the exported (outer) name
  for (const m of content.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) add(name, "const");
    }
  }
}

export function buildSymbolIndex(root: string, roots: string[]): SymbolIndex {
  const symbols = new Map<string, SymbolEntry[]>();
  const files = listFiles(root, roots, 8).filter((f) => f.type === "file" && TEXT_RE.test(f.path));
  for (const f of files) {
    try {
      // listFiles returns paths relative to root; resolve to read.
      const abs = join(root, f.path);
      if (statSync(abs).size > MAX_FILE_BYTES) continue;
      extractFromFile(readFileSync(abs, "utf-8"), f.path, symbols);
    } catch { /* unreadable file — skip */ }
  }
  return { symbols, builtAt: Date.now() };
}

export function findSymbol(index: SymbolIndex, name: string): SymbolEntry[] {
  return index.symbols.get(name.trim().toLowerCase()) || [];
}

// Build fresh per grounding call — files change between prompts, so a TTL cache
// would serve stale symbols. The scan is bounded (depth + per-file size caps).
export function getSymbolIndex(root: string, roots: string[]): SymbolIndex {
  return buildSymbolIndex(root, roots);
}
