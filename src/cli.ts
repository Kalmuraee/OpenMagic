import { Command } from "commander";
import pc from "picocolors";
import open from "open";
import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import { createInterface, clearLine, cursorTo } from "node:readline";
import { createSpinner } from "nanospinner";
import terminalLink from "terminal-link";

// Raise file descriptor limit — Turbopack/Webpack need thousands of watchers.
// macOS launchctl defaults to 256 which causes EMFILE in large projects.
// This only works if the hard limit allows it (user's shell may have already set it).
try { execSync("ulimit -n 65536", { shell: "/bin/sh", stdio: "ignore" }); } catch {}

// Suppress http-proxy deprecation warning noise
const origEmitWarning = process.emitWarning;
process.emitWarning = function (warning: any, ...args: any[]) {
  if (typeof warning === "string" && warning.includes("util._extend")) return;
  return origEmitWarning.call(process, warning, ...args);
} as typeof process.emitWarning;

const INDENT = "  ";
const LABEL_WIDTH = 10;
let activeStatusLine = false;

function clearActiveStatus(): void {
  if (!activeStatusLine || !process.stdout.isTTY) return;
  clearLine(process.stdout, 0);
  cursorTo(process.stdout, 0);
  activeStatusLine = false;
}

function writeLine(line: string = ""): void {
  clearActiveStatus();
  process.stdout.write(line ? `${line}\n` : "\n");
}

function formatInfo(message: string): string {
  return pc.dim(`${INDENT}${message}`);
}

function formatPending(message: string): string {
  return pc.dim(`${INDENT}●  ${message}`);
}

function formatSuccess(message: string): string {
  return pc.green(`${INDENT}✓  ${message}`);
}

function formatReady(seconds: number = process.uptime()): string {
  return pc.green(`${INDENT}✓ Ready in ${seconds.toFixed(1)}s`);
}

function formatWarning(message: string): string {
  return pc.yellow(`${INDENT}▲  ${message}`);
}

function formatError(message: string): string {
  return pc.red(`${INDENT}✗  ${message}`);
}

function printInfo(message: string): void {
  writeLine(formatInfo(message));
}

function printSuccess(message: string): void {
  writeLine(formatSuccess(message));
}

function printReady(): void {
  writeLine(formatReady());
}

function printWarning(message: string): void {
  writeLine(formatWarning(message));
}

function printError(message: string): void {
  writeLine(formatError(message));
}

function printDetail(message: string, formatter: (text: string) => string = pc.dim): void {
  writeLine(formatter(`${INDENT}   ${message}`));
}

function printCommand(message: string): void {
  printDetail(message, pc.cyan);
}

function printLocation(label: string, value: string, brightValue: boolean = false): void {
  const prefix = pc.dim(`${INDENT}➜  ${`${label}:`.padEnd(LABEL_WIDTH)}`);
  const linked = value.startsWith("http") ? terminalLink(value, value) : value;
  const renderedValue = brightValue ? pc.bold(pc.white(linked)) : pc.dim(linked);
  writeLine(`${prefix}${renderedValue}`);
}

// Spinner-based status (animated dots via nanospinner)
let activeSpinner: ReturnType<typeof createSpinner> | null = null;

function startInlineStatus(message: string): void {
  clearActiveStatus();
  activeSpinner = createSpinner(message).start();
}

function finishInlineStatus(message: string): void {
  if (activeSpinner) { activeSpinner.success({ text: message }); activeSpinner = null; }
  else writeLine(formatSuccess(message));
}

function warnInlineStatus(message: string): void {
  if (activeSpinner) { activeSpinner.warn({ text: message }); activeSpinner = null; }
  else writeLine(formatWarning(message));
}

function failInlineStatus(message: string): void {
  if (activeSpinner) { activeSpinner.error({ text: message }); activeSpinner = null; }
  else writeLine(formatError(message));
}

function finishInlineReady(): void {
  const msg = `Ready in ${process.uptime().toFixed(1)}s`;
  if (activeSpinner) { activeSpinner.success({ text: msg }); activeSpinner = null; }
  else writeLine(formatReady());
}

function getDetectedFrameworkLabel(): string | null {
  if (detectedFramework) return detectedFramework;
  const scripts = detectDevScripts();
  return scripts.length > 0 ? scripts[0].framework : null;
}

// Global error handlers — prevent silent crashes
process.on("unhandledRejection", (err) => {
  writeLine();
  printError(`Unhandled error: ${(err as Error)?.message || err}`);
  printDetail("Please report this at https://github.com/Kalmuraee/OpenMagic/issues");
});

process.on("uncaughtException", (err) => {
  writeLine();
  printError(`Fatal error: ${err.message}`);
  printDetail("Please report this at https://github.com/Kalmuraee/OpenMagic/issues");
  process.exit(1);
});

// Check file descriptor limit — warn early if too low for dev servers
try {
  const fdLimit = parseInt(execSync("ulimit -n", { encoding: "utf-8", shell: "/bin/sh" }).trim(), 10);
  if (fdLimit > 0 && fdLimit < 4096) {
    // Try to raise it
    try { execSync("ulimit -n 65536", { shell: "/bin/sh", stdio: "ignore" }); } catch {}
    const newLimit = parseInt(execSync("ulimit -n", { encoding: "utf-8", shell: "/bin/sh" }).trim(), 10);
    if (newLimit < 4096) {
      writeLine();
      printWarning(`File descriptor limit is ${fdLimit} (need 4096+).`);
      printDetail("This can cause EMFILE errors in large Next.js and Turbopack projects.");
      printDetail("Add this to your shell profile:");
      printCommand("ulimit -n 65536");
      printDetail("Then restart your terminal.");
      writeLine();
    }
  }
} catch {}

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

/** Wait for a port to CLOSE (become free). Used after killing orphan processes. */
function waitForPortClose(port: number, timeoutMs: number = 10000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = async () => {
      if (!(await isPortOpen(port))) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 300);
    };
    check();
  });
}

/**
 * Kill a process listening on a given port.
 * Returns true if the process was killed and the port freed.
 */
function killPortProcess(port: number): boolean {
  try {
    const pidOutput = execSync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (!pidOutput) return false;
    const pids = pidOutput.split("\n").map((p) => p.trim()).filter(Boolean);
    for (const pid of pids) {
      try { process.kill(parseInt(pid, 10), "SIGTERM"); } catch {}
    }
    return pids.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a server on the given port is healthy (responds with non-error status).
 * Returns true if healthy, false if not responding or returning errors.
 */
/**
 * Check if a server on the given port is healthy (responds with non-error status).
 * Returns true if healthy, false if not responding or returning errors.
 */
function isPortHealthy(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://${host}:${port}/`,
      { timeout: 3000 },
      (res) => {
        // 2xx/3xx = healthy, 4xx/5xx = unhealthy
        resolve(res.statusCode !== undefined && res.statusCode < 400);
        res.resume(); // drain
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
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
        shell: "/bin/sh",
      });

      child.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          if (line.trim()) writeLine(pc.dim(`${INDENT}│ ${line}`));
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          if (line.trim()) writeLine(pc.dim(`${INDENT}│ ${line}`));
        }
      });

      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

async function healthCheck(
  proxyPort: number,
  _targetPort: number
): Promise<{ message: string; details?: string[] } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Check OpenMagic's own health endpoint (not the app — app may require auth)
    const res = await fetch(`http://127.0.0.1:${proxyPort}/__openmagic__/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) return null;

    return {
      message: "Proxy started, but the toolbar health check failed.",
      details: ["Try refreshing the page in a few seconds."],
    };
  } catch {
    return {
      message: "Could not verify the proxy while it was starting.",
      details: ["Try refreshing the page in a few seconds."],
    };
  }
}

// Detect common dev server errors and show hints
function formatDevServerLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";

  // Detect error patterns and add context
  if (trimmed.startsWith("Error:") || trimmed.includes("ModuleNotFoundError") || trimmed.includes("Can't resolve")) {
    return pc.red(`  │ ${trimmed}`);
  }
  if (trimmed.includes("EADDRINUSE") || trimmed.includes("address already in use")) {
    return pc.red(`${INDENT}│ ${trimmed}`) + "\n" +
      pc.yellow(`${INDENT}│ ➜ Port is already in use. Stop the other process or use --port <different-port>`);
  }
  if (trimmed.includes("EACCES") || trimmed.includes("permission denied")) {
    return pc.red(`${INDENT}│ ${trimmed}`) + "\n" +
      pc.yellow(`${INDENT}│ ➜ Permission denied. Try a different port or check file permissions.`);
  }
  if (trimmed.includes("Cannot find module") || trimmed.includes("MODULE_NOT_FOUND")) {
    return pc.red(`${INDENT}│ ${trimmed}`) + "\n" +
      pc.yellow(`${INDENT}│ ➜ Missing dependency. Try running npm install.`);
  }

  return pc.dim(`${INDENT}│ ${trimmed}`);
}

// Track which framework was detected (for diagnostic hints)
let detectedFramework: string | null = null;

/**
 * After the proxy starts, check if the upstream app actually serves content.
 * If it returns 404, warn with framework-specific troubleshooting hints.
 */
async function validateAppHealth(targetHost: string, targetPort: number): Promise<boolean> {
  // Retry up to 10 times over ~15 seconds — the port may be open but the app
  // hasn't compiled yet (common with Next.js Turbopack first compile)
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`http://${targetHost}:${targetPort}/`, {
        signal: controller.signal,
        redirect: "manual",
        headers: { Accept: "text/html" },
      });
      clearTimeout(timeout);

      const status = res.status;

      // 2xx or redirect → app is healthy
      if (status >= 200 && status < 400) return true;

      // 404 might be temporary during compilation — retry a few times
      if (status === 404 && attempt < 6) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

    if (status === 404) {
      printWarning("Your app returned 404 for the root path (/).");
      printDetail("The dev server is running, but no page matched the root path.");

      if (detectedFramework === "Next.js") {
        const strayLockfiles = scanParentLockfiles(process.cwd());
        if (strayLockfiles.length > 0) {
          printDetail("Found lockfiles in parent directories that can confuse Turbopack.");
          for (const f of strayLockfiles) {
            printDetail(`- ${f}`);
          }
          printDetail("Fix it by removing those lockfiles, or add this to next.config:");
          printCommand("turbopack: { root: __dirname }");
        } else {
          printDetail("Common Next.js causes:");
          printDetail("- Missing src/app/page.tsx (App Router) or pages/index.tsx");
          printDetail("- Middleware redirecting all routes to an auth provider");
        }
      } else if (detectedFramework === "Angular") {
        printDetail("Angular hint: make sure the base href matches the proxy path.");
      } else if (detectedFramework === "Vite") {
        printDetail("Vite hint: check that index.html exists in the project root.");
      } else {
        printDetail("Check your framework's routing configuration.");
      }

      printDetail("The toolbar is still available — navigate to a working route.");
      writeLine();
      return false;
    } else if (status >= 500) {
      printWarning(`Your app returned HTTP ${status} on the root path.`);
      printDetail("There may be a server-side error. Check your dev server output.");
      writeLine();
      // 5xx might be temporary during startup — retry
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return false;
    }
    } catch {
      // Connection failed or timeout — retry
      if (attempt < 6) {
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
    }
  }
  return false;
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
    writeLine();
    writeLine(`${INDENT}${pc.white("OpenMagic")} ${pc.dim(`v${VERSION}`)}`);
    writeLine();

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

        const frameworkLabel = getDetectedFrameworkLabel() ?? "dev server";
        printSuccess(`Found ${frameworkLabel} on port ${targetPort}`);
      }
    } else {
      // Auto-detect running dev server
      startInlineStatus("Scanning for dev server...");
      const detected = await detectDevServer();

      if (detected && detected.fromScripts) {
        // Trusted detection via package.json scripts — but verify it's healthy.
        // An orphaned dev server from a previous OpenMagic session may still be
        // on the port but serving errors (zombie/dying process).
        const healthy = await isPortHealthy(detected.host, detected.port);
        if (healthy) {
          targetPort = detected.port;
          targetHost = detected.host;
          const frameworkLabel = getDetectedFrameworkLabel() ?? "dev server";
          finishInlineStatus(`Found ${frameworkLabel} on port ${detected.port}`);
        } else {
          warnInlineStatus(`Dev server on port ${detected.port} is not responding`);
          printDetail("Cleaning up the orphaned process...");
          killPortProcess(detected.port);
          // Wait for the port to be freed
          const freed = await waitForPortClose(detected.port, 5000);
          if (!freed) {
            // Force kill
            try {
              const pidOutput = execSync(`lsof -i :${detected.port} -sTCP:LISTEN -t 2>/dev/null`, {
                encoding: "utf-8", timeout: 3000,
              }).trim();
              for (const pid of pidOutput.split("\n").filter(Boolean)) {
                try { process.kill(parseInt(pid, 10), "SIGKILL"); } catch {}
              }
              await waitForPortClose(detected.port, 3000);
            } catch {}
          }
          // Start a fresh dev server
          const started = await offerToStartDevServer();
          if (!started) { process.exit(1); }
          if (lastDetectedPort) {
            targetPort = lastDetectedPort;
          } else {
            const redetected = await detectDevServer();
            if (redetected) {
              targetPort = redetected.port;
              targetHost = redetected.host;
            } else {
              printError("Could not detect the dev server after starting.");
              printDetail("Try specifying the port manually:");
              printCommand("npx openmagic --port 3000");
              process.exit(1);
            }
          }

          const frameworkLabel = getDetectedFrameworkLabel() ?? "dev server";
          printSuccess(`Found ${frameworkLabel} on port ${targetPort}`);
        }
      } else if (detected && !detected.fromScripts) {
        // Found a port via generic scan — confirm with user
        finishInlineStatus(`Found dev server on port ${detected.port}`);
        const answer = await ask(
          pc.yellow(`${INDENT}▲  Found a server on port ${detected.port}. Is this your project's dev server? `) +
          pc.dim("(Y/n) ")
        );
        if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes" || answer === "") {
          targetPort = detected.port;
          targetHost = detected.host;
        } else {
          writeLine(formatInfo("Cancelled dev server selection."));
          writeLine();
          printInfo("Start your dev server, then run:");
          printCommand("npx openmagic --port <your-port>");
          writeLine();
          process.exit(0);
        }
      } else {
        // No server running — try to detect and start from package.json
        warnInlineStatus("No dev server found. Starting one...");
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
            printError("Could not detect the dev server after starting.");
            printDetail("Try specifying the port manually:");
            printCommand("npx openmagic --port 3000");
            writeLine();
            process.exit(1);
          }
          targetPort = redetected.port;
          targetHost = redetected.host;
        }

        const frameworkLabel = getDetectedFrameworkLabel() ?? "dev server";
        printSuccess(`Found ${frameworkLabel} on port ${targetPort}`);
      }
    }

    // Detect framework for diagnostic hints (even if server was already running)
    if (!detectedFramework) {
      const scripts = detectDevScripts();
      if (scripts.length > 0) detectedFramework = scripts[0].framework;
    }

    // Proactive warning: detect parent lockfiles that confuse Turbopack
    if (detectedFramework === "Next.js") {
      const strayLockfiles = scanParentLockfiles(process.cwd());
      if (strayLockfiles.length > 0) {
        writeLine();
        printWarning("Lockfiles found in parent directories.");
        for (const f of strayLockfiles) {
          printDetail(`- ${f}`);
        }
        printDetail("Next.js Turbopack may use the wrong workspace root and cause 404s.");
        printDetail("Fix it by removing those lockfiles, or add this to next.config:");
        printCommand("turbopack: { root: __dirname }");
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
    const requestedProxyPort = parseInt(opts.listen, 10);
    let proxyPort = requestedProxyPort;
    while (await isPortOpen(proxyPort)) {
      proxyPort++;
      if (proxyPort > requestedProxyPort + 100) {
        printError("Could not find an available port for the OpenMagic proxy.");
        process.exit(1);
      }
    }

    if (proxyPort !== requestedProxyPort) {
      writeLine();
      printWarning(`Port ${requestedProxyPort} is in use — starting on ${proxyPort}`);
    }

    // Single server: proxy + toolbar + WebSocket all on one port
    const proxyServer = createProxyServer(targetHost, targetPort!, roots);

    proxyServer.listen(proxyPort, "localhost", async () => {
      const proxyUrl = `http://localhost:${proxyPort}`;
      const proxyWarning = await healthCheck(proxyPort, targetPort!);
      const frameworkLabel = getDetectedFrameworkLabel();
      const targetLabel = frameworkLabel
        ? `${targetHost}:${targetPort!} (${frameworkLabel})`
        : `${targetHost}:${targetPort!}`;

      printLocation("Local", proxyUrl, true);
      printLocation("Target", targetLabel);
      writeLine();

      // Wait for the upstream app to actually serve content before opening browser
      // (Next.js Turbopack can take 5-15s to compile after port opens)
      startInlineStatus("Waiting for app to compile...");
      await validateAppHealth(targetHost, targetPort!);
      finishInlineReady();

      if (proxyWarning) {
        writeLine();
        printWarning(proxyWarning.message);
        for (const detail of proxyWarning.details || []) {
          printDetail(detail);
        }
      }

      writeLine();
      printInfo("Press Ctrl+C to stop");
      writeLine();

      if (opts.open !== false) {
        open(`http://localhost:${proxyPort}`).catch(() => {});
      }
    });

    // Graceful shutdown — ensure child processes AND the dev server port are
    // fully released before exiting. This prevents the "404 on restart" bug
    // where an orphaned dev server zombie holds the port.
    //
    // Strategy:
    // 1. SIGTERM direct children (they also got SIGINT from the terminal)
    // 2. Kill any process still listening on the dev server port (catches grandchildren)
    // 3. Wait for the port to actually close (TCP poll)
    // 4. SIGKILL anything remaining after 3s
    // 5. Only then call process.exit(0)
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      writeLine();
      printInfo("Shutting down OpenMagic...");
      cleanupBackups();
      proxyServer.close();

      // Step 1: SIGTERM direct children
      const alive = childProcesses.filter((cp) => cp.exitCode === null);
      for (const cp of alive) {
        try { cp.kill("SIGTERM"); } catch {}
      }

      // Step 2: Also kill anything on the dev server port (catches grandchildren
      // like Next.js workers that our direct child.kill() won't reach)
      if (targetPort) {
        killPortProcess(targetPort);
      }

      // Step 3: Wait for the port to actually close (poll every 200ms, up to 4s)
      if (targetPort && (await isPortOpen(targetPort))) {
        const freed = await waitForPortClose(targetPort, 4000);
        if (!freed) {
          // Step 4: Force-kill everything on the port
          printInfo("Force-killing remaining processes...");
          if (targetPort) {
            try {
              const pids = execSync(`lsof -i :${targetPort} -sTCP:LISTEN -t 2>/dev/null`, {
                encoding: "utf-8", timeout: 2000,
              }).trim().split("\n").filter(Boolean);
              for (const pid of pids) {
                try { process.kill(parseInt(pid, 10), "SIGKILL"); } catch {}
              }
            } catch {}
          }
          for (const cp of childProcesses) {
            if (cp.exitCode === null) {
              try { cp.kill("SIGKILL"); } catch {}
            }
          }
          // Brief wait for SIGKILL to take effect
          await new Promise((r) => setTimeout(r, 300));
        }
      } else {
        // No port to wait on — just wait for children
        if (alive.length > 0) {
          await Promise.race([
            Promise.all(alive.map((cp) => new Promise<void>((r) => {
              if (cp.exitCode !== null) { r(); return; }
              cp.once("exit", () => r());
            }))),
            new Promise<void>((r) => setTimeout(() => {
              for (const cp of childProcesses) {
                if (cp.exitCode === null) try { cp.kill("SIGKILL"); } catch {}
              }
              setTimeout(r, 200);
            }, 3000)),
          ]);
        }
      }

      process.exit(0);
    };

    process.on("SIGINT", () => { shutdown(); });
    process.on("SIGTERM", () => { shutdown(); });
  });

// --- Smart Dev Server Start ---

async function offerToStartDevServer(expectedPort?: number): Promise<boolean> {
  const projectName = getProjectName();
  const scripts = detectDevScripts();

  if (scripts.length === 0) {
    // Check for plain HTML project (index.html without package.json scripts)
    const htmlPath = join(process.cwd(), "index.html");
    if (existsSync(htmlPath)) {
      printInfo("No dev scripts found, but index.html was detected.");
      writeLine();
      const answer = await ask(
        pc.dim(`${INDENT}Serve this directory as a static site? `) + pc.dim("(Y/n) ")
      );
      if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
        return false;
      }

      // Start a built-in static file server using Node's http module
      const staticPort = expectedPort || 8080;
      startInlineStatus(`Starting static server on port ${staticPort}...`);

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
        }).listen(${staticPort}, "localhost");
      `], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      childProcesses.push(staticChild);
      staticChild.stdout?.on("data", (d: Buffer) => {
        for (const line of d.toString().trim().split("\n")) {
          if (line.trim()) writeLine(pc.dim(`${INDENT}│ ${line}`));
        }
      });

      // Wait for it to start
      const up = await waitForPort(staticPort, 5000);
      if (up) {
        lastDetectedPort = staticPort;
        finishInlineStatus(`Static server running on port ${staticPort}`);
        return true;
      }
      failInlineStatus("Static server failed to start");
      return false;
    }

    printWarning("No dev server detected and no dev scripts were found.");
    writeLine();
    printInfo("Start your dev server manually, then run:");
    printCommand("npx openmagic --port <your-port>");
    writeLine();
    return false;
  }

  // Check if dependencies are installed
  const deps = checkDependenciesInstalled();
  if (!deps.installed) {
    printWarning("node_modules was not found. Dependencies need to be installed.");
    writeLine();

    const answer = await ask(
      pc.white(`${INDENT}Run `) +
      pc.cyan(deps.installCommand) +
      pc.white("? ") +
      pc.dim("(Y/n) ")
    );

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      writeLine();
      printInfo(`Run ${deps.installCommand} manually, then try again.`);
      writeLine();
      return false;
    }

    writeLine();
    printInfo(`Installing dependencies with ${deps.packageManager}...`);

    const [installCmd, ...installArgs] = deps.installCommand.split(" ");
    const installed = await runCommand(installCmd, installArgs);

    if (!installed) {
      printError("Dependency installation failed.");
      printDetail(`Try running ${deps.installCommand} manually.`);
      writeLine();
      return false;
    }

    printSuccess("Dependencies installed.");
    writeLine();
  }

  // Pick the best script
  let chosen = scripts[0];
  if (scripts.length === 1) {
    // Only one option
    printWarning("No dev server detected.");
    writeLine();
    writeLine(
      pc.white(`${INDENT}Found `) +
      pc.cyan(`npm run ${chosen.name}`) +
      pc.white(` in ${projectName}`) +
      pc.dim(` (${chosen.framework})`)
    );
    printDetail(`➜ ${chosen.command}`);
    writeLine();

    const answer = await ask(
      pc.white(`${INDENT}Start it now? `) + pc.dim("(Y/n) ")
    );

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      writeLine();
      printInfo("Start your dev server first, then run OpenMagic again.");
      writeLine();
      return false;
    }
  } else {
    // Multiple scripts — let user pick
    printWarning("No dev server detected.");
    writeLine();
    writeLine(
      pc.white(`${INDENT}Found ${scripts.length} dev scripts in ${projectName}:`)
    );
    writeLine();

    scripts.forEach((s, i) => {
      writeLine(
        pc.cyan(`${INDENT}${i + 1}. `) +
        pc.white(`npm run ${s.name}`) +
        pc.dim(` (${s.framework}, port ${s.defaultPort})`)
      );
      printDetail(s.command);
    });

    writeLine();
    const answer = await ask(
      pc.white(`${INDENT}Which one should OpenMagic start? `) +
      pc.dim(`(1-${scripts.length}, or n to cancel) `)
    );

    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no" || answer === "") {
      writeLine();
      printInfo("Start your dev server first, then run OpenMagic again.");
      writeLine();
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
    writeLine();
    printError(compat.message || "Node.js version incompatible");
    writeLine();
    printInfo("Switch Node.js before running:");
    printCommand("nvm use 20");
    printDetail("Then re-run: npx openmagic");
    writeLine();
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
      printSuccess(`Dev server already running on port ${port}`);
      lastDetectedPort = port;
      return true;
    }
    // Port is taken by something else — find a free one
    const altPort = await findAvailablePort(port + 1);
    writeLine();
    printWarning(`Port ${port} is in use — starting on ${altPort}`);
    port = altPort;
    portChanged = true;
  }

  writeLine();
  writeLine(
    pc.dim(`${INDENT}●  Starting `) +
    pc.cyan(`npm run ${chosen.name}`) +
    (portChanged ? pc.dim(` (port ${port})`) : "") +
    pc.dim("...")
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
    // Wrap in shell with ulimit to prevent EMFILE on large projects.
    // Turbopack/Webpack need thousands of file watchers; macOS default is 256.
    const escapedArgs = runArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
    const shellCmd = `ulimit -n 65536 2>/dev/null; exec ${runCmd} ${escapedArgs}`;

    child = spawn("sh", ["-c", shellCmd], {
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
    printError(`Failed to start: ${(e as Error).message}`);
    return false;
  }

  childProcesses.push(child);
  let childExited = false;

  child.on("error", (err) => {
    childExited = true;
    writeLine();
    printError(`Failed to start: ${err.message}`);
  });

  child.on("exit", (code) => {
    childExited = true;
    if (code !== null && code !== 0) {
      writeLine();
      printError(`Dev server exited with code ${code}`);
    }
  });

  // Safety-net cleanup on exit (main shutdown handler does the real work)
  process.once("exit", () => {
    for (const cp of childProcesses) {
      if (cp.exitCode === null) {
        try { cp.kill("SIGKILL"); } catch {}
      }
    }
  });

  // Wait for the port to open via TCP polling
  writeLine(formatPending(`Waiting for ${chosen.framework} on port ${port}...`));

  const isUp = await waitForPort(port, 60000, () => childExited);

  if (isUp) {
    lastDetectedPort = port;
    printSuccess(`${chosen.framework} is listening on port ${port}`);
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
        printSuccess(`Found ${chosen.framework} on port ${scanPort}`);
        lastDetectedPort = scanPort;
        return true;
      }
    }
  }

  if (childExited) {
    printError("Dev server failed to start");
    writeLine();

    // Check for Node.js version mismatch
    try {
      const pkgPath = join(process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.engines?.node) {
          printWarning(`This project requires Node.js ${pkg.engines.node}`);
          printDetail(`You are running Node.js ${process.version}`);
          writeLine();
        }
      }
    } catch {}

    // Also check framework-specific requirements
    if (chosen?.framework) {
      const compat = checkNodeCompatibility(chosen.framework);
      if (!compat.ok) {
        printWarning(compat.message || "Node.js version may be incompatible");
        printDetail("Switch with:");
        printCommand("nvm use 20");
        writeLine();
      }
    }

    writeLine(pc.white(`${INDENT}Options:`));
    printDetail("1. Fix the error above and try again");
    printDetail("2. Start the server manually, then run:");
    printCommand("npx openmagic --port <your-port>");
    writeLine();
    return false;
  }

  // All detection methods exhausted
  printWarning("Could not find the dev server after 60s");
  printDetail("Check the output above for errors.");
  printDetail("Or start the server manually, then run:");
  printCommand("npx openmagic --port <your-port>");
  writeLine();
  return false;
}

program.parse();
