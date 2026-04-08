import { createConnection } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const COMMON_DEV_PORTS = [
  3000, // React (CRA), Next.js, Express
  5173, // Vite
  5174, // Vite (alternate)
  4200, // Angular
  8080, // Vue CLI, generic
  8000, // Django, Python
  3001, // Common alternate
  4000, // Phoenix, generic
  1234, // Parcel
  4321, // Astro
  3333, // Remix
  8081, // Metro (React Native)
  9000, // generic
  8888, // Jupyter, generic
  5000, // Flask (last — macOS AirPlay also uses 5000)
];

function checkPortSingle(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 1000 });
    socket.unref();
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

// Check both IPv4 and IPv6 — many dev servers (Vite, Node) listen on ::1 only
async function checkPort(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  const results = await Promise.all([
    checkPortSingle(port, host),
    checkPortSingle(port, "::1"),
    checkPortSingle(port, "localhost"),
  ]);
  return results.some(Boolean);
}

export interface DetectedServer {
  port: number;
  host: string;
  fromScripts?: boolean; // true if detected via package.json scripts
}

/**
 * Check if the process listening on a port is running from (or near) the expected directory.
 * Uses lsof on macOS/Linux to get the PID, then checks its working directory.
 * Returns true if verified, false if wrong project, null if can't determine.
 */
export function verifyPortOwnership(port: number, expectedDir: string): boolean | null {
  try {
    // Get PIDs listening on this port
    const pidOutput = execSync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();

    if (!pidOutput) return null;

    const pids = pidOutput.split("\n").map((p) => p.trim()).filter(Boolean);
    const expected = resolve(expectedDir);

    for (const pid of pids) {
      try {
        // Get working directory of this process
        const cwdOutput = execSync(
          `lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep ^n | head -1`,
          { encoding: "utf-8", timeout: 3000 }
        ).trim();

        if (!cwdOutput) continue;
        const processCwd = resolve(cwdOutput.slice(1)); // strip leading 'n'

        // Match if the process cwd is the project dir, a parent, or a child
        if (processCwd === expected || expected.startsWith(processCwd) || processCwd.startsWith(expected)) {
          return true;
        }
      } catch {
        continue;
      }
    }

    // We got PIDs but none matched the project directory
    return false;
  } catch {
    // lsof not available or failed — can't verify
    return null;
  }
}

export async function detectDevServer(cwd: string = process.cwd()): Promise<DetectedServer | null> {
  // First: check ports hinted by the project's dev scripts + .env (most reliable)
  const scripts = detectDevScripts(cwd);
  const envPort = checkEnvPort(cwd);
  const scriptPorts = [
    ...(envPort ? [envPort] : []),
    ...scripts.map((s) => s.defaultPort),
  ].filter((p, i, a) => a.indexOf(p) === i);

  if (scriptPorts.length > 0) {
    for (const port of scriptPorts) {
      if (await checkPort(port)) {
        // Verify this port actually belongs to this project
        const owned = verifyPortOwnership(port, cwd);
        if (owned === false) {
          // Wrong project on this port — skip it
          continue;
        }
        return { port, host: "localhost", fromScripts: true };
      }
    }
    // Scripts exist but none running (or all belong to other projects)
    return null;
  }

  // No recognized scripts — scan common ports (but flag as unverified)
  const checks = COMMON_DEV_PORTS.map(async (port) => {
    const isOpen = await checkPort(port);
    return isOpen ? port : null;
  });

  const results = await Promise.all(checks);

  for (const foundPort of results) {
    if (foundPort === null) continue;
    // For generic scan, also check ownership
    const owned = verifyPortOwnership(foundPort, cwd);
    if (owned === false) continue; // skip — belongs to another project
    return { port: foundPort, host: "localhost", fromScripts: false };
  }

  return null;
}

export async function isPortOpen(port: number): Promise<boolean> {
  return checkPort(port);
}

export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (await isPortOpen(port)) {
    port++;
    if (port > startPort + 100) {
      throw new Error(`Could not find an available port near ${startPort}`);
    }
  }
  return port;
}

// --- Package.json Dev Script Detection ---

export interface DevScript {
  name: string;       // e.g. "dev", "start", "serve"
  command: string;    // e.g. "next dev", "vite", "ng serve"
  framework: string;  // e.g. "Next.js", "Vite", "Angular"
  defaultPort: number;
}

const FRAMEWORK_PATTERNS: Array<{
  match: RegExp;
  framework: string;
  defaultPort: number;
}> = [
  { match: /\bnext\b/, framework: "Next.js", defaultPort: 3000 },
  { match: /\bvite\b/, framework: "Vite", defaultPort: 5173 },
  { match: /\bnuxt\b/, framework: "Nuxt", defaultPort: 3000 },
  { match: /\bng\s+serve\b/, framework: "Angular", defaultPort: 4200 },
  { match: /\bvue-cli-service\s+serve\b/, framework: "Vue CLI", defaultPort: 8080 },
  { match: /\bsvelte-kit\b/, framework: "SvelteKit", defaultPort: 5173 },
  { match: /\bastro\b/, framework: "Astro", defaultPort: 4321 },
  { match: /\bremix\b/, framework: "Remix", defaultPort: 3000 },
  { match: /\breact-scripts\s+start\b/, framework: "Create React App", defaultPort: 3000 },
  { match: /\bparcel\b/, framework: "Parcel", defaultPort: 1234 },
  { match: /\bwebpack\s+serve\b|webpack-dev-server/, framework: "Webpack", defaultPort: 8080 },
  { match: /\bgatsby\b/, framework: "Gatsby", defaultPort: 8000 },
  { match: /\bturborepo\b|\bturbo\b.*dev/, framework: "Turborepo", defaultPort: 3000 },
  { match: /\bexpo\b/, framework: "Expo", defaultPort: 8081 },
  { match: /\bnodemon\b|\bts-node\b|\bnode\b/, framework: "Node.js", defaultPort: 3000 },
  { match: /\bflask\b/, framework: "Flask", defaultPort: 5000 },
  { match: /\bdjango\b|manage\.py\s+runserver/, framework: "Django", defaultPort: 8000 },
  { match: /\brails\b/, framework: "Rails", defaultPort: 3000 },
  { match: /\bphp\s+.*serve\b|artisan\s+serve/, framework: "PHP/Laravel", defaultPort: 8000 },
];

const DEV_SCRIPT_NAMES = ["dev", "start", "serve", "develop", "dev:start", "start:dev", "server", "dev:server", "web", "frontend"];

export function detectDevScripts(cwd: string = process.cwd()): DevScript[] {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return [];

  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return [];
  }

  if (!pkg.scripts) return [];

  const scripts: DevScript[] = [];

  for (const name of DEV_SCRIPT_NAMES) {
    const command = pkg.scripts[name];
    if (!command) continue;

    // Detect framework from command
    let framework = "Unknown";
    let defaultPort = 3000;

    for (const pattern of FRAMEWORK_PATTERNS) {
      if (pattern.match.test(command)) {
        framework = pattern.framework;
        defaultPort = pattern.defaultPort;
        break;
      }
    }

    // Try to extract port from command (e.g., --port 4000, -p 8080)
    const portMatch = command.match(/(?:--port|-p)\s+(\d+)/);
    if (portMatch) {
      defaultPort = parseInt(portMatch[1], 10);
    }

    scripts.push({ name, command, framework, defaultPort });
  }

  return scripts;
}

// --- Node.js Version Compatibility ---

// Minimum Node.js versions for modern frameworks (conservative — covers latest majors)
const FRAMEWORK_NODE_REQUIREMENTS: Record<string, { minNode: string; label: string }> = {
  "Next.js":          { minNode: "18.17.0", label: "Next.js 14+" },
  "Vite":             { minNode: "18.0.0",  label: "Vite 5+" },
  "Angular":          { minNode: "18.13.0", label: "Angular 17+" },
  "SvelteKit":        { minNode: "18.13.0", label: "SvelteKit 2+" },
  "Nuxt":             { minNode: "18.0.0",  label: "Nuxt 3+" },
  "Astro":            { minNode: "18.14.1", label: "Astro 4+" },
  "Remix":            { minNode: "18.0.0",  label: "Remix 2+" },
  "Create React App": { minNode: "14.0.0",  label: "Create React App" },
  "Gatsby":           { minNode: "18.0.0",  label: "Gatsby 5+" },
  "Vue CLI":          { minNode: "14.0.0",  label: "Vue CLI" },
  "Webpack":          { minNode: "14.0.0",  label: "Webpack 5+" },
  "Parcel":           { minNode: "16.0.0",  label: "Parcel 2+" },
};

function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true; // equal
}

export function checkNodeCompatibility(framework: string): { ok: boolean; message?: string } {
  const req = FRAMEWORK_NODE_REQUIREMENTS[framework];
  if (!req) return { ok: true };

  const current = process.versions.node;
  if (!semverGte(current, req.minNode)) {
    return {
      ok: false,
      message: `${req.label} requires Node.js >= ${req.minNode}, but you are running v${current}`,
    };
  }
  return { ok: true };
}

// --- .env PORT detection ---

/**
 * Check .env files for a PORT variable. Helps detect when the dev server
 * is configured to run on a non-default port via environment.
 */
export function checkEnvPort(cwd: string = process.cwd()): number | null {
  const envFiles = [".env.local", ".env.development.local", ".env.development", ".env"];
  for (const envFile of envFiles) {
    const envPath = join(cwd, envFile);
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, "utf-8");
      const match = content.match(/^PORT\s*=\s*(\d+)/m);
      if (match) return parseInt(match[1], 10);
    } catch {
      continue;
    }
  }
  return null;
}

// --- Parent lockfile scanning (Turbopack workspace root detection) ---

const LOCKFILE_NAMES = ["package-lock.json", "bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml"];

/**
 * Scan parent directories for lockfiles that could confuse Turbopack's
 * workspace root detection. Returns paths of lockfiles found above the
 * project directory (up to and including the home directory).
 */
export function scanParentLockfiles(projectDir: string): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const project = resolve(projectDir);
  const found: string[] = [];

  let dir = resolve(project, "..");
  while (dir.length > 1 && dir.length >= home.length) {
    for (const lockfile of LOCKFILE_NAMES) {
      const p = join(dir, lockfile);
      if (existsSync(p)) found.push(p);
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return found;
}

// --- Project name ---

export function getProjectName(cwd: string = process.cwd()): string {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "this project";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.name || "this project";
  } catch {
    return "this project";
  }
}

// --- Dependency Installation Check ---

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export interface DependencyStatus {
  installed: boolean;
  packageManager: PackageManager;
  installCommand: string;
}

const LOCK_FILES: Array<{ file: string; pm: PackageManager }> = [
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "bun.lockb", pm: "bun" },
  { file: "bun.lock", pm: "bun" },
  { file: "package-lock.json", pm: "npm" },
];

const INSTALL_COMMANDS: Record<PackageManager, string> = {
  npm: "npm install",
  yarn: "yarn install",
  pnpm: "pnpm install",
  bun: "bun install",
};

export function checkDependenciesInstalled(cwd: string = process.cwd()): DependencyStatus {
  const hasNodeModules = existsSync(join(cwd, "node_modules"));

  // Detect package manager from lock file
  let pm: PackageManager = "npm";
  for (const { file, pm: detectedPm } of LOCK_FILES) {
    if (existsSync(join(cwd, file))) {
      pm = detectedPm;
      break;
    }
  }

  return {
    installed: hasNodeModules,
    packageManager: pm,
    installCommand: INSTALL_COMMANDS[pm],
  };
}
