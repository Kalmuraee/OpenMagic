import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { OpenMagicConfig } from "./shared-types.js";

const CONFIG_DIR = join(homedir(), ".openmagic");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Partial<OpenMagicConfig> {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveConfig(updates: Partial<OpenMagicConfig>): { ok: boolean; error?: string } {
  try {
    ensureConfigDir();
    const existing = loadConfig();
    const merged = { ...existing, ...updates };
    const tmpFile = CONFIG_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(merged, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmpFile, CONFIG_FILE);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getConfigDir(): string {
  ensureConfigDir();
  return CONFIG_DIR;
}
