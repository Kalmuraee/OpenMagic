// CLI update check: on startup, ask the npm registry whether a newer version
// exists and, if so, suggest the right update command for how OpenMagic was
// launched. Network is fail-silent (never blocks or breaks a run).

export type InstallKind = "npx" | "global";

/** Compare two semver releases numerically. Prerelease/build suffixes are
 *  ignored (compared by their release numbers only). Returns -1 | 0 | 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split("-")[0].split("+")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/** Heuristic: npx runs from the npm `_npx` cache; everything else is treated as
 *  an installed copy (global or linked). */
export function detectInstallKind(scriptPath: string): InstallKind {
  return /[\\/]_npx[\\/]/.test(scriptPath) ? "npx" : "global";
}

export function suggestedUpdateCommand(kind: InstallKind): string {
  return kind === "npx" ? "npx openmagic@latest" : "npm install -g openmagic@latest";
}

export function formatUpdateNotice(current: string, latest: string, command: string): string {
  return `Update available: ${current} → ${latest}. Run \`${command}\` to update.`;
}

/** Fetch the latest published version from the npm registry. Fail-silent. */
export async function fetchLatestVersion(pkg = "openmagic", timeoutMs = 2500): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null; // offline / timeout / registry down — never surface an error
  }
}

/** Returns an update notice string if a newer version is published, else null. */
export async function checkForCliUpdate(
  current: string,
  scriptPath: string,
  timeoutMs = 2500
): Promise<string | null> {
  const latest = await fetchLatestVersion("openmagic", timeoutMs);
  if (!latest || !isNewerVersion(latest, current)) return null;
  return formatUpdateNotice(current, latest, suggestedUpdateCommand(detectInstallKind(scriptPath)));
}
