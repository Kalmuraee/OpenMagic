
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


function parentForRoot(parentGroupId: string | undefined, root: string): string | undefined {
  if (!parentGroupId) return undefined;
  const composite = decodeComposite(parentGroupId);
  if (!composite) return parentGroupId;
  return composite.find((child) => child.root === root)?.groupId;
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
    const result = applyPatchGroup(group.root, { patches: group.patches, parentGroupId: parentForRoot(request.parentGroupId, group.root) });
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
