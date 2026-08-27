
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
