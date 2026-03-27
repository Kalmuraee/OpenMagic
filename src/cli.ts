import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import { resolve } from "node:path";
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
} from "./detect.js";
import { loadConfig, saveConfig } from "./config.js";

const VERSION = "0.28.6";

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
  timeoutMs: number = 30000,
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
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 500);
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

      if (detected) {
        targetPort = detected.port;
        targetHost = detected.host;
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

    console.log(
      chalk.green(`  ✓  Dev server running at ${targetHost}:${targetPort}`)
    );

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
    console.log(
      chalk.yellow("  ⚠  No dev server detected and no dev scripts found in package.json")
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

  // Start the dev server
  const port = expectedPort || chosen.defaultPort;

  console.log("");
  console.log(
    chalk.dim(`  Starting `) +
    chalk.cyan(`npm run ${chosen.name}`) +
    chalk.dim("...")
  );

  // Use the correct package manager run command
  const depsInfo = checkDependenciesInstalled();
  const runCmd = depsInfo.packageManager === "yarn" ? "yarn" :
    depsInfo.packageManager === "pnpm" ? "pnpm" :
    depsInfo.packageManager === "bun" ? "bun" : "npm";
  const runArgs = runCmd === "npm" ? ["run", chosen.name] : [chosen.name];

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(runCmd, runArgs, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      shell: true,
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
  let detectedPort: number | null = null; // Port detected from dev server output

  // Watch stdout/stderr for the actual port the server starts on
  function parsePortFromOutput(line: string) {
    // Strip ALL escape sequences and control characters (ANSI SGR, OSC, hyperlinks, etc.)
    const clean = line
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  // OSC sequences (hyperlinks, titles)
      .replace(/\x1b[^a-zA-Z]*[a-zA-Z]/g, "")               // CSI/SGR sequences
      .replace(/[\x00-\x1f\x7f]/g, "");                      // remaining control chars

    // Match: "http://localhost:3000", "https://127.0.0.1:8080", etc.
    const portMatch = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/);
    if (portMatch && !detectedPort) {
      const p = parseInt(portMatch[1], 10);
      if (p > 0 && p < 65536 && p !== port) {
        detectedPort = p;
        return;
      }
    }

    // Fallback: look for "port XXXX" or ":XXXX" patterns in clean text
    if (!detectedPort) {
      const fallback = clean.match(/(?:port|Port|PORT)\s+(\d{4,5})/);
      if (fallback) {
        const p = parseInt(fallback[1], 10);
        if (p > 0 && p < 65536 && p !== port) {
          detectedPort = p;
        }
      }
    }
  }

  child.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().trim().split("\n")) {
      parsePortFromOutput(line);
      const formatted = formatDevServerLine(line);
      if (formatted) process.stdout.write(formatted + "\n");
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().trim().split("\n")) {
      parsePortFromOutput(line);
      const formatted = formatDevServerLine(line);
      if (formatted) process.stdout.write(formatted + "\n");
    }
  });

  child.on("error", (err) => {
    childExited = true;
    console.log(chalk.red(`  ✗  Failed to start: ${err.message}`));
  });

  child.on("exit", (code) => {
    childExited = true;
    if (code !== null && code !== 0) {
      console.log(chalk.red(`  ✗  Dev server exited with code ${code}`));
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
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for the port to open — also watch for the actual port from dev server output
  console.log(
    chalk.dim(`  Waiting for dev server...`)
  );

  const isUp = await waitForPort(port, 30000, () => {
    if (childExited) return true;
    // If we detected a different port from the output, check that instead
    if (detectedPort) return true;
    return false;
  });

  // If the expected port didn't open but we detected a different one from output
  if (!isUp && detectedPort) {
    const altUp = await isPortOpen(detectedPort);
    if (altUp) {
      console.log(
        chalk.green(`  ✓  Dev server is on port ${detectedPort} (configured in project, not default ${port})`)
      );
      lastDetectedPort = detectedPort;
      return true;
    }
  }

  if (childExited && !isUp) {
    console.log(
      chalk.red(`  ✗  Dev server exited before it was ready.`)
    );
    console.log(
      chalk.dim(`     Check the error output above and fix the issue.`)
    );
    console.log("");
    return false;
  }

  if (!isUp) {
    // Last resort: scan ALL common ports (bypass the script-based optimization)
    // because the dev server might be on a custom port configured in the project
    for (const scanPort of [3000, 3001, 5173, 5174, 4200, 8080, 8000, 4000, 1234, 4321, 3333, 8081]) {
      if (scanPort === port) continue; // Already tried this one
      if (await isPortOpen(scanPort)) {
        console.log(
          chalk.green(`  ✓  Dev server found on port ${scanPort}.`)
        );
        lastDetectedPort = scanPort;
        return true;
      }
    }

    console.log(
      chalk.yellow(`  ⚠  Port ${port} didn't open after 30s.`)
    );
    console.log(
      chalk.dim(`     The server might use a different port. Check the output above.`)
    );
    console.log("");

    // Try to detect any port that opened
    const detected = await detectDevServer();
    if (detected) {
      console.log(
        chalk.green(`  ✓  Found server on port ${detected.port} instead.`)
      );
      return true;
    }

    return false;
  }

  console.log("");
  return true;
}

program.parse();
