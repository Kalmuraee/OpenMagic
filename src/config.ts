import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

export function saveConfig(updates: Partial<OpenMagicConfig>): void {
  try {
    ensureConfigDir();
    const existing = loadConfig();
    const merged = { ...existing, ...updates };
    writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
  } catch (e: unknown) {
    console.warn(`[OpenMagic] Warning: Could not save config to ${CONFIG_FILE}: ${(e as Error).message}`);
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
