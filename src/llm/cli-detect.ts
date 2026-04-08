import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Auto-detection for CLI coding agents (Claude Code, Codex, Gemini).
 *
 * Detection is two-phase:
 * 1. Install check: spawn("cmd", ["--version"]) — fast, cross-platform
 * 2. Auth check: file/env var inspection — no process spawn needed
 *
 * Priority order (based on benchmark performance):
 * 1. Claude Code — 80.9% SWE-bench, best multi-file coherence
 * 2. Codex CLI — 77.3% Terminal-Bench, strong autonomous execution
 * 3. Gemini CLI — 1M token context, free tier
 */

export interface CliStatus {
  id: string;           // Provider ID matching registry (e.g., "claude-code")
  name: string;         // Display name
  command: string;      // CLI command name
  installed: boolean;
  authenticated: boolean;
  version?: string;
}

/** All detectable CLI agents in priority order */
const CLI_AGENTS = [
  { id: "claude-code", name: "Claude Code", command: "claude" },
  { id: "codex-cli", name: "Codex CLI", command: "codex" },
  { id: "gemini-cli", name: "Gemini CLI", command: "gemini" },
] as const;

// ── In-memory cache (60s TTL) ─────────────────────────────────────

let cachedResults: CliStatus[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000; // 60 seconds

/** Invalidate cache (call after a CLI error to re-detect) */
export function invalidateCliCache(): void {
  cachedResults = null;
  cacheTimestamp = 0;
}

// ── Main detection ────────────────────────────────────────────────

/**
 * Detect all available CLI coding agents.
 * Returns a list sorted by priority, with install/auth status.
 * Results are cached for 60 seconds.
 */
export async function detectAvailableClis(): Promise<CliStatus[]> {
  if (cachedResults && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedResults;
  }

  const results = await Promise.all(
    CLI_AGENTS.map(async (agent) => {
      const { installed, version } = await checkInstalled(agent.command);
      const authenticated = installed
        ? checkAuthenticated(agent.id)
        : false;

      return {
        id: agent.id,
        name: agent.name,
        command: agent.command,
        installed,
        authenticated,
        version,
      };
    })
  );

  cachedResults = results;
  cacheTimestamp = Date.now();
  return results;
}

/**
 * Get the best available CLI agent (first that's installed + authenticated).
 * Returns null if no CLI agent is available.
 */
export async function getBestAvailableCli(): Promise<CliStatus | null> {
  const clis = await detectAvailableClis();
  return clis.find((c) => c.installed && c.authenticated) || null;
}

// ── Install detection ─────────────────────────────────────────────

function checkInstalled(command: string): Promise<{ installed: boolean; version?: string }> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(command, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });

      let stdout = "";
      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });

      proc.on("error", () => resolve({ installed: false }));
      proc.on("close", (code) => {
        if (code === 0) {
          // Extract version from output (common formats: "v1.2.3", "1.2.3", "tool 1.2.3")
          const match = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({ installed: true, version: match?.[1] });
        } else {
          resolve({ installed: false });
        }
      });
    } catch {
      resolve({ installed: false });
    }
  });
}

// ── Auth detection (file/env checks — no process spawn) ──────────

function checkAuthenticated(cliId: string): boolean {
  switch (cliId) {
    case "claude-code":
      return isClaudeAuthenticated();
    case "codex-cli":
      return isCodexAuthenticated();
    case "gemini-cli":
      return isGeminiAuthenticated();
    default:
      return false;
  }
}

/**
 * Claude Code auth check:
 * 1. ANTHROPIC_API_KEY env var
 * 2. ~/.claude/.claude.json with oauthAccount key
 */
function isClaudeAuthenticated(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;

  try {
    const configPath = join(
      process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      ".claude.json"
    );
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.oauthAccount) return true;
    }
  } catch {}

  return false;
}

/**
 * Codex CLI auth check:
 * 1. OPENAI_API_KEY env var
 * 2. ~/.codex/auth.json exists with valid content
 */
function isCodexAuthenticated(): boolean {
  if (process.env.OPENAI_API_KEY) return true;

  try {
    const authPath = join(
      process.env.CODEX_HOME || join(homedir(), ".codex"),
      "auth.json"
    );
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf-8"));
      if (auth.auth_mode && (auth.OPENAI_API_KEY || auth.tokens)) return true;
    }
  } catch {}

  return false;
}

/**
 * Gemini CLI auth check:
 * 1. GEMINI_API_KEY or GOOGLE_API_KEY env var
 * 2. ~/.gemini/oauth_creds.json with refresh_token
 */
function isGeminiAuthenticated(): boolean {
  if (process.env.GEMINI_API_KEY) return true;
  if (process.env.GOOGLE_API_KEY) return true;

  try {
    const credsPath = join(homedir(), ".gemini", "oauth_creds.json");
    if (existsSync(credsPath)) {
      const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
      if (creds.refresh_token) return true;
    }
  } catch {}

  return false;
}
