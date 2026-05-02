import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { deleteFileSafe, isPathSafe, readFileSafe, writeFileSafe } from "./filesystem.js";

export type FilePatch =
  | { type: "replace"; file: string; search: string; replace: string }
  | { type: "create"; file: string; content: string }
  | { type: "delete"; file: string };

export interface PatchGroupRequest {
  patches: FilePatch[];
  dryRun?: boolean;
}

export interface PatchPreviewChange {
  file: string;
  type: FilePatch["type"];
  ok: boolean;
  reason?: string;
  matchedRange?: { start: number; end: number };
  confidence?: number;
}

export interface PatchPreviewResult {
  ok: boolean;
  changes: PatchPreviewChange[];
}

export interface PatchApplyResult extends PatchPreviewResult {
  groupId?: string;
  applied: boolean;
}

interface PlannedPatch {
  patch: FilePatch;
  path: string;
  existed: boolean;
  originalContent: string;
  nextContent?: string;
  delete?: boolean;
  change: PatchPreviewChange;
}

interface PatchManifest {
  groupId: string;
  timestamp: number;
  files: Array<{
    path: string;
    existed: boolean;
    content: string;
  }>;
}

const manifests = new Map<string, PatchManifest>();

export function previewPatch(root: string, patch: FilePatch): PatchPreviewResult {
  const planned = planPatches(root, [patch]);
  return {
    ok: planned.every((item) => item.change.ok),
    changes: planned.map((item) => item.change),
  };
}

export function previewPatchGroup(root: string, request: PatchGroupRequest): PatchPreviewResult {
  const planned = planPatches(root, request.patches);
  return {
    ok: planned.every((item) => item.change.ok),
    changes: planned.map((item) => item.change),
  };
}

export function applyPatchGroup(root: string, request: PatchGroupRequest): PatchApplyResult {
  const planned = planPatches(root, request.patches);
  const preview = {
    ok: planned.every((item) => item.change.ok),
    changes: planned.map((item) => item.change),
  };

  if (!preview.ok || request.dryRun) {
    return { ...preview, applied: false };
  }

  const groupId = createGroupId();
  const manifest: PatchManifest = {
    groupId,
    timestamp: Date.now(),
    files: planned.map((item) => ({
      path: item.path,
      existed: item.existed,
      content: item.originalContent,
    })),
  };

  const applied: PlannedPatch[] = [];
  for (const item of planned) {
    let result: { ok: boolean; error?: string };
    if (item.delete) {
      result = deleteFileSafe(item.path, [root]);
    } else {
      result = writeFileSafe(item.path, item.nextContent || "", [root]);
    }

    if (!result.ok) {
      rollbackApplied(root, applied);
      return {
        ok: false,
        applied: false,
        changes: planned.map((plannedItem) => plannedItem === item
          ? { ...plannedItem.change, ok: false, reason: result.error || "Patch write failed" }
          : plannedItem.change),
      };
    }

    applied.push(item);
  }

  manifests.set(groupId, manifest);
  return { ...preview, groupId, applied: true };
}

export function rollbackPatchGroup(root: string, groupId: string): { ok: boolean; error?: string; groupId: string; files?: string[] } {
  const manifest = manifests.get(groupId);
  if (!manifest) return { ok: false, groupId, error: "Patch group not found" };

  for (const file of manifest.files) {
    if (file.existed) {
      const result = writeFileSafe(file.path, file.content, [root]);
      if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to restore ${file.path}` };
    } else if (existsSync(file.path)) {
      const result = deleteFileSafe(file.path, [root]);
      if (!result.ok) return { ok: false, groupId, error: result.error || `Failed to remove ${file.path}` };
    }
  }

  manifests.delete(groupId);
  return { ok: true, groupId, files: manifest.files.map((file) => file.path) };
}

export function clearPatchManifests(): void {
  manifests.clear();
}

function planPatches(root: string, patches: FilePatch[]): PlannedPatch[] {
  const stagedContent = new Map<string, { existed: boolean; content: string; originalContent: string }>();

  return patches.map((patch) => {
    const path = resolvePatchPath(root, patch.file);
    const base = loadBaseContent(root, path, stagedContent);
    const initialChange: PatchPreviewChange = { file: patch.file, type: patch.type, ok: false };

    if (!isPatchPathSafe(root, path)) {
      return {
        patch,
        path,
        existed: false,
        originalContent: "",
        change: { ...initialChange, reason: "Path is outside allowed root" },
      };
    }

    if ("error" in base) {
      if (patch.type === "create") {
        const next = patch.content;
        stagedContent.set(path, { existed: false, content: next, originalContent: "" });
        return {
          patch,
          path,
          existed: false,
          originalContent: "",
          nextContent: next,
          change: { ...initialChange, ok: true },
        };
      }

      return {
        patch,
        path,
        existed: false,
        originalContent: "",
        change: { ...initialChange, reason: base.error },
      };
    }

    if (patch.type === "create") {
      if (base.existed) {
        return {
          patch,
          path,
          existed: base.existed,
          originalContent: base.originalContent,
          change: { ...initialChange, reason: "File already exists" },
        };
      }
      stagedContent.set(path, { existed: false, content: patch.content, originalContent: "" });
      return {
        patch,
        path,
        existed: false,
        originalContent: "",
        nextContent: patch.content,
        change: { ...initialChange, ok: true },
      };
    }

    if (patch.type === "delete") {
      stagedContent.set(path, { existed: base.existed, content: "", originalContent: base.originalContent });
      return {
        patch,
        path,
        existed: base.existed,
        originalContent: base.originalContent,
        delete: true,
        change: { ...initialChange, ok: true },
      };
    }

    const match = findReplacement(base.content, patch.search, patch.replace);
    if (!match.ok) {
      return {
        patch,
        path,
        existed: base.existed,
        originalContent: base.originalContent,
        change: { ...initialChange, reason: match.reason },
      };
    }

    const replacement = match.replace ?? patch.replace;
    const next = base.content.slice(0, match.start) + replacement + base.content.slice(match.end);
    stagedContent.set(path, { existed: base.existed, content: next, originalContent: base.originalContent });
    return {
      patch,
      path,
      existed: base.existed,
      originalContent: base.originalContent,
      nextContent: next,
      change: {
        ...initialChange,
        ok: true,
        matchedRange: { start: match.start, end: match.end },
        confidence: match.confidence,
      },
    };
  });
}

function resolvePatchPath(root: string, file: string): string {
  return resolve(root, file);
}

function isPatchPathSafe(root: string, path: string): boolean {
  return isPathSafe(path, [root]);
}

function loadBaseContent(
  root: string,
  path: string,
  stagedContent: Map<string, { existed: boolean; content: string; originalContent: string }>
): { existed: boolean; content: string; originalContent: string } | { error: string } {
  const staged = stagedContent.get(path);
  if (staged) {
    return { existed: staged.existed, content: staged.content, originalContent: staged.originalContent };
  }

  if (!existsSync(path)) {
    return { error: "File not found" };
  }

  const read = readFileSafe(path, [root]);
  if ("error" in read) return { error: read.error };
  return { existed: true, content: read.content, originalContent: read.content };
}

function findReplacement(
  content: string,
  search: string,
  replace: string
): { ok: true; start: number; end: number; confidence: number; replace?: string } | { ok: false; reason: string } {
  if (!search) return { ok: false, reason: "Replace patch is missing search text" };

  const exactMatches = findAll(content, search);
  if (exactMatches.length === 1) {
    return { ok: true, start: exactMatches[0], end: exactMatches[0] + search.length, confidence: 1 };
  }
  if (exactMatches.length > 1) {
    return { ok: false, reason: `Found ${exactMatches.length} exact matches; refusing ambiguous replace` };
  }

  const whitespace = normalizedLineMatch(content, search, (line) => line.trim());
  if (whitespace.status === "ambiguous") {
    return { ok: false, reason: `Found ${whitespace.count} whitespace-normalized matches; refusing ambiguous replace` };
  }
  if (whitespace.match) {
    return {
      ...whitespace.match,
      ok: true,
      confidence: 0.95,
      replace: reindentReplacement(search, replace, whitespace.match.indent, whitespace.match.indents),
    };
  }

  const indentation = indentationAdjustedMatch(content, search, replace);
  if (indentation.status === "ambiguous") {
    return { ok: false, reason: `Found ${indentation.count} indentation-adjusted matches; refusing ambiguous replace` };
  }
  if (indentation.match) {
    return { ...indentation.match, ok: true, confidence: 0.9 };
  }

  const fuzzy = fuzzyLineMatch(content, search);
  if (!fuzzy) return { ok: false, reason: "No matching code found" };
  if (fuzzy.confidence < 0.8) return { ok: false, reason: `Low-confidence fuzzy match (${fuzzy.confidence.toFixed(2)})` };

  return { ok: true, start: fuzzy.start, end: fuzzy.end, confidence: fuzzy.confidence };
}

function findAll(content: string, search: string): number[] {
  const matches: number[] = [];
  let index = content.indexOf(search);
  while (index !== -1) {
    matches.push(index);
    index = content.indexOf(search, index + Math.max(1, search.length));
  }
  return matches;
}

function normalizedLineMatch(
  content: string,
  search: string,
  normalize: (line: string) => string
): { status: "ok"; match: { start: number; end: number; indent: string; indents: string[] } | null; count: number } | { status: "ambiguous"; count: number } {
  const searchLines = search.split("\n");
  const normalizedSearch = searchLines.map(normalize).join("\n");
  if (!normalizedSearch.trim()) return { status: "ok", match: null, count: 0 };

  const contentLines = content.split("\n");
  const matches: Array<{ start: number; end: number; indent: string; indents: string[] }> = [];
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    const candidate = candidateLines.map(normalize).join("\n");
    if (candidate === normalizedSearch) {
      matches.push({
        ...lineRangeToOffsets(contentLines, i, searchLines.length),
        indent: firstNonEmptyIndent(candidateLines),
        indents: candidateLines.map(lineIndent),
      });
    }
  }

  if (matches.length > 1) return { status: "ambiguous", count: matches.length };
  return { status: "ok", match: matches[0] || null, count: matches.length };
}

function indentationAdjustedMatch(
  content: string,
  search: string,
  replace: string
): { status: "ok"; match: { start: number; end: number; replace: string } | null; count: number } | { status: "ambiguous"; count: number } {
  const searchLines = search.split("\n");
  const strippedSearch = searchLines.map(stripLeadingWhitespace).join("\n");
  if (!strippedSearch.trim()) return { status: "ok", match: null, count: 0 };

  const contentLines = content.split("\n");
  const matches: Array<{ start: number; end: number; indent: string; indents: string[] }> = [];
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    if (candidateLines.map(stripLeadingWhitespace).join("\n") === strippedSearch) {
      matches.push({
        ...lineRangeToOffsets(contentLines, i, searchLines.length),
        indent: firstNonEmptyIndent(candidateLines),
        indents: candidateLines.map(lineIndent),
      });
    }
  }

  if (matches.length > 1) return { status: "ambiguous", count: matches.length };
  const match = matches[0];
  if (!match) return { status: "ok", match: null, count: 0 };
  return {
    status: "ok",
    match: { start: match.start, end: match.end, replace: reindentReplacement(search, replace, match.indent, match.indents) },
    count: 1,
  };
}

function stripLeadingWhitespace(line: string): string {
  return line.replace(/^\s+/, "");
}

function firstNonEmptyIndent(lines: string[]): string {
  const line = lines.find((candidate) => candidate.trim().length > 0) || "";
  return lineIndent(line);
}

function lineIndent(line: string): string {
  return line.match(/^\s*/)?.[0] || "";
}

function reindentReplacement(search: string, replace: string, targetIndent: string, candidateIndents: string[] = []): string {
  const searchIndent = firstNonEmptyIndent(search.split("\n"));
  return replace.split("\n").map((line, index) => {
    if (!line.trim()) return line;
    const candidateIndent = candidateIndents[index];
    if (candidateIndent !== undefined) return candidateIndent + stripLeadingWhitespace(line);
    if (searchIndent && line.startsWith(searchIndent)) return targetIndent + line.slice(searchIndent.length);
    return targetIndent + stripLeadingWhitespace(line);
  }).join("\n");
}

function fuzzyLineMatch(content: string, search: string): { start: number; end: number; confidence: number } | null {
  const searchLines = search.split("\n");
  const nonEmptySearch = searchLines.map((line) => line.trim()).filter(Boolean);
  if (nonEmptySearch.length === 0) return null;

  const contentLines = content.split("\n");
  let best: { startLine: number; lineCount: number; score: number } | null = null;

  for (let i = 0; i <= contentLines.length - nonEmptySearch.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    const candidate = candidateLines.join("\n").trim();
    const score = similarity(candidate, search.trim());
    if (!best || score > best.score) {
      best = { startLine: i, lineCount: candidateLines.length, score };
    }
  }

  if (!best) return null;
  const range = lineRangeToOffsets(contentLines, best.startLine, best.lineCount);
  return { start: range.start, end: range.end, confidence: best.score };
}

function lineRangeToOffsets(lines: string[], start: number, count: number): { start: number; end: number } {
  const content = lines.join("\n");
  let startOffset = 0;
  for (let i = 0; i < start; i++) startOffset += lines[i].length + 1;

  let endOffset = startOffset;
  for (let i = start; i < start + count; i++) endOffset += lines[i].length + 1;
  if (endOffset > 0 && endOffset <= content.length && content[endOffset - 1] === "\n") endOffset--;
  return { start: startOffset, end: endOffset };
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const trigramsA = trigrams(a);
  const trigramsB = trigrams(b);
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0;
  let intersection = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) intersection++;
  }
  return intersection / (trigramsA.size + trigramsB.size - intersection);
}

function trigrams(value: string): Set<string> {
  const normalized = value.replace(/\s+/g, " ").trim();
  const result = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    result.add(normalized.slice(i, i + 3));
  }
  return result;
}

function rollbackApplied(root: string, applied: PlannedPatch[]): void {
  for (const item of [...applied].reverse()) {
    try {
      if (item.existed) {
        writeFileSafe(item.path, item.originalContent, [root]);
      } else if (existsSync(item.path)) {
        deleteFileSafe(item.path, [root]);
      }
    } catch {}
  }
}

function createGroupId(): string {
  return `patch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
