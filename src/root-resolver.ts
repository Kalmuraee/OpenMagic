
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { toPortablePath } from "./path-utils.js";

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
    const relativePath = toPortablePath(relative(root, absolutePath));
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
    const relativePath = toPortablePath(relative(item.root, item.absolutePath));
    return { ...item, relativePath, displayPath: displayPathFor(item.root, relativePath, roots) };
  }

  if (options.forCreate) {
    const parentMatches = roots
      .map((root) => ({ root, absolutePath: resolve(root, requested) }))
      .filter((item) => isPathWithinRoot(item.absolutePath, item.root) && existsSync(dirname(item.absolutePath)));
    if (parentMatches.length === 1) {
      const item = parentMatches[0];
      const relativePath = toPortablePath(relative(item.root, item.absolutePath));
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
  const relativePath = toPortablePath(relative(root, absolutePath));
  return { root, absolutePath, relativePath, displayPath: displayPathFor(root, relativePath, roots) };
}
