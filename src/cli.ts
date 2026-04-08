import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

// Suppress http-proxy deprecation warning noise
const origEmitWarning = process.emitWarning;
process.emitWarning = function (warning: any, ...args: any[]) {
  if (typeof warning === "string" && warning.includes("util._extend")) return;
  return origEmitWarning.call(process, warning, ...args);
} as typeof process.emitWarning;

// Global error handlers — prevent silent crashes
process.on("unhandledRejection", (err) => {
  console.error(chalk.red("\n  [OpenMagic] Unhandled error:"), (err as Error)?.message || err);
  console.error(chalk.dim("  Please report this at https://github.com/Kalmuraee/OpenMagic/issues"));
});

process.on("uncaughtException", (err) => {
  console.error(chalk.red("\n  [OpenMagic] Fatal error:"), err.message);
  console.error(chalk.dim("  Please report this at https://github.com/Kalmuraee/OpenMagic/issues"));
  process.exit(1);
});

// Track child processes for cleanup
const childProcesses: ChildProcess[] = [];
let lastDetectedPort: number | null = null; // Port detected from dev server output
import { createProxyServer } from "./proxy.js";
import { generateSessionToken } from "./security.js";
import {
  detectDevServer,
  findAvailablePort,
  isPortOpen,
  detectDevScripts,
  getProjectName,
  checkDependenciesInstalled,
  verifyPortOwnership,
  checkNodeCompatibility,
  scanParentLockfiles,
} from "./detect.js";
import { loadConfig, saveConfig } from "./config.js";
import { cleanupBackups } from "./filesystem.js";

import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const VERSION: string = _require("../package.json").version;

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function waitForPort(
  port: number,
  timeoutMs: number = 60000,
  shouldAbort?: () => boolean
): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = async () => {
      if (shouldAbort?.()) {
        resolve(false);
        return;
      }
      if (await isPortOpen(port)) {
        resolve(true);
        return;
      }
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        resolve(false);
        return;
      }
      // Aggressive early polling, then back off
      const interval = elapsed < 10000 ? 300 : 1000;
      setTimeout(check, interval);
    };
    check();
  });
}

function runCommand(cmd: string, args: string[], cwd: string = process.cwd()): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });

      child.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          if (line.trim()) process.stdout.write(chalk.dim(`  │ ${line}\n`));
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          if (line.trim()) process.stdout.write(chalk.dim(`  │ ${line}\n`));
        }
      });

      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

async function healthCheck(proxyPort: number, _targetPort: number): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Check OpenMagic's own health endpoint (not the app — app may require auth)
    const res = await fetch(`http://127.0.0.1:${proxyPort}/__openmagic__/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      console.log(chalk.green("  ✓  Toolbar ready."));
    } else {
      console.log(chalk.yellow("  ⚠  Proxy started but toolbar health check failed."));
    }
  } catch {
    console.log(
      chalk.yellow("  ⚠  Could not verify proxy. The dev server may still be starting.")
    );
    console.log(
      chalk.dim("     Try refreshing the page in a few seconds.")
    );
  }
  console.log("");
}

// Detect common dev server errors and show hints
function formatDevServerLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";

  // Detect error patterns and add context
  if (trimmed.startsWith("Error:") || trimmed.includes("ModuleNotFoundError") || trimmed.includes("Can't resolve")) {
    return chalk.red(`  │ ${trimmed}`);
  }
  if (trimmed.includes("EADDRINUSE") || trimmed.includes("address already in use")) {
    return chalk.red(`  │ ${trimmed}`) + "\n" +
      chalk.yellow("  │ → Port is already in use. Stop the other process or use --port <different-port>");
  }
  if (trimmed.includes("EACCES") || trimmed.includes("permission denied")) {
    return chalk.red(`  │ ${trimmed}`) + "\n" +
      chalk.yellow("  │ → Permission denied. Try a different port or check file permissions.");
  }
  if (trimmed.includes("Cannot find module") || trimmed.includes("MODULE_NOT_FOUND")) {
    return chalk.red(`  │ ${trimmed}`) + "\n" +
      chalk.yellow("  │ → Missing dependency. Try running npm install.");
  }

  return chalk.dim(`  │ ${trimmed}`);
}

// Track which framework was detected (for diagnostic hints)
let detectedFramework: string | null = null;

/**
 * After the proxy starts, check if the upstream app actually serves content.
 * If it returns 404, warn with framework-specific troubleshooting hints.
 */
async function validateAppHealth(targetHost: string, targetPort: number): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`http://${targetHost}:${targetPort}/`, {
      signal: controller.signal,
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    clearTimeout(timeout);

    const status = res.status;

    // 2xx or redirect → app is healthy
    if (status >= 200 && status < 400) return;

    if (status === 404) {
      console.log(chalk.yellow("  ⚠  Your app returned 404 for the root path (\"/\")."));
      console.log(chalk.dim("     The dev server is running, but no page matched."));
      console.log("");

      if (detectedFramework === "Next.js") {
        const strayLockfiles = scanParentLockfiles(process.cwd());
        if (strayLockfiles.length > 0) {
          console.log(chalk.yellow("     Found lockfiles in parent directories that confuse Turbopack:"));
          for (const f of strayLockfiles) {
            console.log(chalk.dim(`       • ${f}`));
          }
          console.log("");
          console.log(chalk.dim("     Fix: remove them, or add to your next.config:"));
          console.log(chalk.cyan("       turbopack: { root: __dirname }"));
        } else {
          console.log(chalk.dim("     Common Next.js causes:"));
          console.log(chalk.dim("     • Missing src/app/page.tsx (App Router) or pages/index.tsx"));
          console.log(chalk.dim("     • Middleware redirecting all routes to an auth provider"));
        }
      } else if (detectedFramework === "Angular") {
        console.log(chalk.dim("     Angular hint: ensure the base href matches the proxy path."));
      } else if (detectedFramework === "Vite") {
        console.log(chalk.dim("     Vite hint: check that index.html exists in the project root."));
      } else {
        console.log(chalk.dim("     Check your framework's routing configuration."));
      }

      console.log("");
      console.log(chalk.dim("     The toolbar is still available — navigate to a working route."));
      console.log("");
    } else if (status >= 500) {
      console.log(chalk.yellow(`  ⚠  Your app returned HTTP ${status} on the root path.`));
      console.log(chalk.dim("     There may be a server-side error. Check your dev server output."));
      console.log("");
    }
  } catch {
    // Connection failed or timeout — don't warn here, proxy error page handles it
  }
}

const program = new Command();

program
  .name("openmagic")
  .description("AI-powered coding toolbar for any web application")
  .version(VERSION)
  .option("-p, --port <port>", "Dev server port to proxy", "")
  .option(
    "-l, --listen <port>",
    "Port for the OpenMagic proxy",
    "4567"
  )
  .option(
    "-r, --root <paths...>",
    "Project root directories (defaults to cwd)"
  )
  .option("--no-open", "Don't auto-open browser")
  .option("--host <host>", "Dev server host", "localhost")
  .action(async (opts) => {
    console.log("");
    console.log(
      "  🪄 " + chalk.bold.hex("#6c5ce7")("OpenMagic") + chalk.dim(` v${VERSION}`) + " ✨"
    );
    console.log(chalk.dim("  AI coding toolbar for any web app"));
    console.log("");

    let targetPort: number;
    let targetHost = opts.host;

    if (opts.port) {
      // User specified a port
      targetPort = parseInt(opts.port, 10);
      const isRunning = await isPortOpen(targetPort);
      if (!isRunning) {
        // Port specified but not running — offer to start it
        const started = await offerToStartDevServer(targetPort);
        if (!started) {
          process.exit(1);
        }
        // Use port detected from dev server output, or re-detect
        if (lastDetectedPort) {
          targetPort = lastDetectedPort;
        } else {
          const recheck = await detectDevServer();
          if (recheck) { targetPort = recheck.port; targetHost = recheck.host; }
        }
      }
    } else {
      // Auto-detect running dev server
      console.log(chalk.dim("  Scanning for dev server..."));
      const detected = await detectDevServer();

      if (detected && detected.fromScripts) {
        // Trusted detection via package.json scripts
        targetPort = detected.port;
        targetHost = detected.host;
      } else if (detected && !detected.fromScripts) {
        // Found a port via generic scan — confirm with user
        const answer = await ask(
          chalk.yellow(`  Found a server on port ${detected.port}. Is this your project's dev server? `) +
          chalk.dim("(y/n) ")
        );
        if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes" || answer === "") {
          targetPort = detected.port;
          targetHost = detected.host;
        } else {
          console.log("");
          console.log(chalk.dim("  Start your dev server, then run:"));
          console.log(chalk.cyan("    npx openmagic --port <your-port>"));
          console.log("");
          process.exit(0);
        }
      } else {
        // No server running — try to detect and start from package.json
        const started = await offerToStartDevServer();
        if (!started) {
          process.exit(1);
        }
        // Use port from dev server output, or re-detect
        if (lastDetectedPort) {
          targetPort = lastDetectedPort;
        } else {
          const redetected = await detectDevServer();
          if (!redetected) {
            console.log(chalk.red("  ✗  Could not detect the dev server after starting."));
            console.log(chalk.dim("     Try specifying the port: npx openmagic --port 3000"));
            console.log("");
            process.exit(1);
          }
          targetPort = redetected.port;
          targetHost = redetected.host;
        }
      }
    }

    // Detect framework for diagnostic hints (even if server was already running)
    if (!detectedFramework) {
      const scripts = detectDevScripts();
      if (scripts.length > 0) detectedFramework = scripts[0].framework;
    }

    console.log(
      chalk.green(`  ✓  Dev server running at ${targetHost}:${targetPort}`)
    );

    // Proactive warning: detect parent lockfiles that confuse Turbopack
    if (detectedFramework === "Next.js") {
      const strayLockfiles = scanParentLockfiles(process.cwd());
      if (strayLockfiles.length > 0) {
        console.log("");
        console.log(chalk.yellow("  ⚠  Lockfiles found in parent directories:"));
        for (const f of strayLockfiles) {
          console.log(chalk.dim(`     • ${f}`));
        }
        console.log(chalk.dim("     Next.js Turbopack may use the wrong workspace root, causing 404s."));
        console.log(chalk.dim("     Fix: remove them, or add to next.config:"));
        console.log(chalk.cyan("       turbopack: { root: __dirname }"));
      }
    }

    // Set up roots
    const roots = (opts.root || [process.cwd()]).map((r: string) =>
      resolve(r)
    );

    // Save roots to config
    const config = loadConfig();
    saveConfig({ ...config, roots, targetPort });

    // Generate session token
    generateSessionToken();

    // Find available port (single port — proxy + toolbar + WS all on same origin)
    let proxyPort = parseInt(opts.listen, 10);
    while (await isPortOpen(proxyPort)) {
      proxyPort++;
      if (proxyPort > parseInt(opts.listen, 10) + 100) {
        console.log(chalk.red("  Could not find an available port."));
        process.exit(1);
      }
    }

    // Single server: proxy + toolbar + WebSocket all on one port
    const proxyServer = createProxyServer(targetHost, targetPort!, roots);

    proxyServer.listen(proxyPort, "localhost", async () => {
      const proxyUrl = `http://localhost:${proxyPort}`;
      console.log("");
      console.log(chalk.bold.green("  Ready!"));
      console.log("");
      console.log(
        chalk.bold("  → ") + chalk.bold.underline.cyan(proxyUrl)
      );
      console.log("");

      await healthCheck(proxyPort, targetPort!);

      // Validate the upstream app actually serves content
      await validateAppHealth(targetHost, targetPort!);

      console.log(chalk.dim("  Press Ctrl+C to stop."));
      console.log(
        chalk.dim("  Errors below are from your dev server, not OpenMagic.")
      );
      console.log("");

      if (opts.open !== false) {
        open(`http://localhost:${proxyPort}`).catch(() => {});
      }
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log("");
      console.log(chalk.dim("  Shutting down OpenMagic..."));
      cleanupBackups();
      proxyServer.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

// --- Smart Dev Server Start ---

async function offerToStartDevServer(expectedPort?: number): Promise<boolean> {
  const projectName = getProjectName();
  const scripts = detectDevScripts();

  if (scripts.length === 0) {
    // Check for plain HTML project (index.html without package.json scripts)
    const htmlPath = join(process.cwd(), "index.html");
    if (existsSync(htmlPath)) {
      console.log(
        chalk.dim("  No dev scripts found, but index.html detected.")
      );
      console.log("");
      const answer = await ask(
        chalk.white("  Serve this directory as a static site? ") + chalk.dim("(Y/n) ")
      );
      if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
        return false;
      }

      // Start a built-in static file server using Node's http module
      const staticPort = expectedPort || 8080;
      console.log(chalk.dim(`  Starting static server on port ${staticPort}...`));

      const staticChild = spawn("node", ["-e", `
        const http = require("http");
        const fs = require("fs");
        const path = require("path");
        const mimes = {".html":"text/html",".css":"text/css",".js":"application/javascript",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon",".gif":"image/gif",".woff2":"font/woff2",".woff":"font/woff"};
        http.createServer((req, res) => {
          let p = path.join(${JSON.stringify(process.cwd())}, req.url === "/" ? "/index.html" : req.url);
          try { p = decodeURIComponent(p); } catch {}
          fs.readFile(p, (err, data) => {
            if (err) { res.writeHead(404); res.end("Not found"); return; }
            const ext = path.extname(p).toLowerCase();
            res.writeHead(200, {"Content-Type": mimes[ext] || "application/octet-stream"});
            res.end(data);
          });
        }).listen(${staticPort}, "localhost", () => console.log("Static server ready on port ${staticPort}"));
      `], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      childProcesses.push(staticChild);
      staticChild.stdout?.on("data", (d: Buffer) => {
        for (const line of d.toString().trim().split("\n")) {
          if (line.trim()) process.stdout.write(chalk.dim(`  │ ${line}\n`));
        }
      });

      // Wait for it to start
      const up = await waitForPort(staticPort, 5000);
      if (up) {
        lastDetectedPort = staticPort;
        console.log(chalk.green(`  ✓  Static server running on port ${staticPort}`));
        return true;
      }
      console.log(chalk.red("  ✗  Failed to start static server."));
      return false;
    }

    console.log(
      chalk.yellow("  ⚠  No dev server detected and no dev scripts found.")
    );
    console.log("");
    console.log(chalk.white("  Start your dev server manually, then run:"));
    console.log(chalk.cyan("    npx openmagic --port <your-port>"));
    console.log("");
    return false;
  }

  // Check if dependencies are installed
  const deps = checkDependenciesInstalled();
  if (!deps.installed) {
    console.log(
      chalk.yellow("  ⚠  node_modules/ not found. Dependencies need to be installed.")
    );
    console.log("");

    const answer = await ask(
      chalk.white(`  Run `) +
      chalk.cyan(deps.installCommand) +
      chalk.white("? ") +
      chalk.dim("(Y/n) ")
    );

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      console.log("");
      console.log(chalk.dim(`  Run ${deps.installCommand} manually, then try again.`));
      console.log("");
      return false;
    }

    console.log("");
    console.log(chalk.dim(`  Installing dependencies with ${deps.packageManager}...`));

    const [installCmd, ...installArgs] = deps.installCommand.split(" ");
    const installed = await runCommand(installCmd, installArgs);

    if (!installed) {
      console.log(chalk.red("  ✗  Dependency installation failed."));
      console.log(chalk.dim(`     Try running ${deps.installCommand} manually.`));
      console.log("");
      return false;
    }

    console.log(chalk.green("  ✓  Dependencies installed."));
    console.log("");
  }

  // Pick the best script
  let chosen = scripts[0];
  if (scripts.length === 1) {
    // Only one option
    console.log(
      chalk.yellow("  ⚠  No dev server detected.")
    );
    console.log("");
    console.log(
      chalk.white(`  Found `) +
      chalk.cyan(`npm run ${chosen.name}`) +
      chalk.white(` in ${projectName}`) +
      chalk.dim(` (${chosen.framework})`)
    );
    console.log(chalk.dim(`     → ${chosen.command}`));
    console.log("");

    const answer = await ask(
      chalk.white(`  Start it now? `) + chalk.dim("(Y/n) ")
    );

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      console.log("");
      console.log(chalk.dim("  Start your dev server first, then run openmagic again."));
      console.log("");
      return false;
    }
  } else {
    // Multiple scripts — let user pick
    console.log(
      chalk.yellow("  ⚠  No dev server detected.")
    );
    console.log("");
    console.log(
      chalk.white(`  Found ${scripts.length} dev scripts in ${projectName}:`)
    );
    console.log("");

    scripts.forEach((s, i) => {
      console.log(
        chalk.cyan(`    ${i + 1}) `) +
        chalk.white(`npm run ${s.name}`) +
        chalk.dim(` — ${s.framework} (port ${s.defaultPort})`)
      );
      console.log(chalk.dim(`       ${s.command}`));
    });

    console.log("");
    const answer = await ask(
      chalk.white(`  Which one to start? `) +
      chalk.dim(`(1-${scripts.length}, or n to cancel) `)
    );

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no" || answer === "") {
      console.log("");
      console.log(chalk.dim("  Start your dev server first, then run openmagic again."));
      console.log("");
      return false;
    }

    const idx = parseInt(answer, 10) - 1;
    if (idx < 0 || idx >= scripts.length || isNaN(idx)) {
      // Default to first
      chosen = scripts[0];
    } else {
      chosen = scripts[idx];
    }
  }

  // Track framework for diagnostic hints later
  detectedFramework = chosen.framework;

  // Pre-flight: check Node.js version compatibility
  const compat = checkNodeCompatibility(chosen.framework);
  if (!compat.ok) {
    console.log(chalk.red(`\n  ✗  ${compat.message}`));
    console.log("");
    console.log(chalk.white("  Switch Node.js version before running:"));
    console.log(chalk.cyan("    nvm use 20"));
    console.log(chalk.dim("    # then re-run: npx openmagic"));
    console.log("");
    return false;
  }

  // Start the dev server
  let port = expectedPort || chosen.defaultPort;

  // Check if the expected port is already occupied by another process
  let portChanged = false;
  if (await isPortOpen(port)) {
    const owned = verifyPortOwnership(port, process.cwd());
    if (owned === true) {
      // Port is occupied by this project — already running
      console.log(chalk.green(`  ✓  Dev server already running on port ${port}`));
      lastDetectedPort = port;
      return true;
    }
    // Port is taken by something else — find a free one
    const altPort = await findAvailablePort(port + 1);
    console.log("");
    console.log(
      chalk.yellow(`  ⚠  Port ${port} is already in use by another process.`)
    );
    console.log(
      chalk.dim(`     Starting on port ${altPort} instead.`)
    );
    port = altPort;
    portChanged = true;
  }

  console.log("");
  console.log(
    chalk.dim(`  Starting `) +
    chalk.cyan(`npm run ${chosen.name}`) +
    (portChanged ? chalk.dim(` (port ${port})`) : "") +
    chalk.dim("...")
  );

  // Use the correct package manager run command
  const depsInfo = checkDependenciesInstalled();
  const runCmd = depsInfo.packageManager === "yarn" ? "yarn" :
    depsInfo.packageManager === "pnpm" ? "pnpm" :
    depsInfo.packageManager === "bun" ? "bun" : "npm";
  const runArgs = runCmd === "npm" ? ["run", chosen.name] : [chosen.name];

  // If port was changed due to conflict, pass --port to frameworks that accept it
  const PORT_FLAG_FRAMEWORKS = new Set(["Next.js", "Vite", "Angular", "Vue CLI", "Astro", "Remix", "SvelteKit", "Nuxt", "Create React App", "Gatsby", "Parcel", "Webpack"]);
  if (portChanged && PORT_FLAG_FRAMEWORKS.has(chosen.framework)) {
    if (runCmd === "npm") {
      runArgs.push("--", "--port", String(port));
    } else {
      runArgs.push("--port", String(port));
    }
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(runCmd, runArgs, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(port),
        BROWSER: "none",
        BROWSER_NONE: "true",
      },
    });
  } catch (e: unknown) {
    console.log(chalk.red(`  ✗  Failed to start: ${(e as Error).message}`));
    return false;
  }

  childProcesses.push(child);
  let childExited = false;

  child.on("error", (err) => {
    childExited = true;
    console.log(chalk.red(`\n  ✗  Failed to start: ${err.message}`));
  });

  child.on("exit", (code) => {
    childExited = true;
    if (code !== null && code !== 0) {
      console.log(chalk.red(`\n  ✗  Dev server exited with code ${code}`));
    }
  });

  // Clean up all child processes on exit
  const cleanup = () => {
    for (const cp of childProcesses) {
      try { cp.kill("SIGTERM"); } catch {}
    }
    setTimeout(() => {
      for (const cp of childProcesses) {
        try { cp.kill("SIGKILL"); } catch {}
      }
    }, 3000);
  };
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  // Wait for the port to open via TCP polling
  console.log(
    chalk.dim(`  Waiting for dev server on port ${port}...`)
  );

  const isUp = await waitForPort(port, 60000, () => childExited);

  if (isUp) {
    lastDetectedPort = port;
    console.log("");
    return true;
  }

  // Port didn't open but process is still running — scan nearby ports
  if (!childExited) {
    const scanPorts = [port, 3000, 3001, 3002, 5173, 5174, 4200, 8080, 8000, 4000, 1234, 4321, 3333, 8081]
      .filter((p, i, a) => a.indexOf(p) === i); // dedupe
    for (const scanPort of scanPorts) {
      if (await isPortOpen(scanPort)) {
        const owned = verifyPortOwnership(scanPort, process.cwd());
        if (owned === false) continue;
        console.log(
          chalk.green(`\n  ✓  Dev server found on port ${scanPort}.`)
        );
        lastDetectedPort = scanPort;
        return true;
      }
    }
  }

  if (childExited) {
    console.log(
      chalk.red(`  ✗  Dev server failed to start.`)
    );
    console.log("");

    // Check for Node.js version mismatch
    try {
      const pkgPath = join(process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.engines?.node) {
          console.log(chalk.yellow(`  This project requires Node.js ${pkg.engines.node}`));
          console.log(chalk.dim(`  You are running Node.js ${process.version}`));
          console.log("");
        }
      }
    } catch {}

    // Also check framework-specific requirements
    if (chosen?.framework) {
      const compat = checkNodeCompatibility(chosen.framework);
      if (!compat.ok) {
        console.log(chalk.yellow(`  ${compat.message}`));
        console.log(chalk.dim("  Switch with: nvm use 20"));
        console.log("");
      }
    }

    console.log(chalk.white("  Options:"));
    console.log(chalk.dim("  1. Fix the error above and try again"));
    console.log(chalk.dim("  2. Start the server manually, then run:"));
    console.log(chalk.cyan("     npx openmagic --port <your-port>"));
    console.log("");
    return false;
  }

  // All detection methods exhausted
  console.log(
    chalk.yellow(`\n  ⚠  Could not find the dev server after 60s.`)
  );
  console.log(chalk.dim(`     Check the output above for errors.`));
  console.log(chalk.dim(`     Or start the server manually, then run:`));
  console.log(chalk.cyan(`     npx openmagic --port <your-port>`));
  console.log("");
  return false;
}

program.parse();
