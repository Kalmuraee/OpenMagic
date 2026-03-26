import { createConnection } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const COMMON_DEV_PORTS = [
  3000, // React (CRA), Next.js, Express
  5173, // Vite
  5174, // Vite (alternate)
  4200, // Angular
  8080, // Vue CLI, generic
  8000, // Django, Python
  8888, // Jupyter, generic
  3001, // Common alternate
  4000, // Phoenix, generic
  1234, // Parcel
  4321, // Astro
  3333, // Remix
  8081, // Metro (React Native)
  9000, // generic
];

function checkPort(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 500 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export interface DetectedServer {
  port: number;
  host: string;
}

export async function detectDevServer(): Promise<DetectedServer | null> {
  const checks = COMMON_DEV_PORTS.map(async (port) => {
    const isOpen = await checkPort(port);
    return isOpen ? port : null;
  });

  const results = await Promise.all(checks);
  const foundPort = results.find((p) => p !== null);

  if (foundPort) {
    return { port: foundPort, host: "127.0.0.1" };
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

const DEV_SCRIPT_NAMES = ["dev", "start", "serve", "develop", "dev:start", "start:dev"];

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
