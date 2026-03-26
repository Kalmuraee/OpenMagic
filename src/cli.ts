import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createProxyServer } from "./proxy.js";
import { createOpenMagicServer } from "./server.js";
import { generateSessionToken } from "./security.js";
import {
  detectDevServer,
  findAvailablePort,
  isPortOpen,
  detectDevScripts,
  getProjectName,
} from "./detect.js";
import { loadConfig, saveConfig } from "./config.js";

const VERSION = "0.3.0";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function waitForPort(port: number, timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = async () => {
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
  .option("--host <host>", "Dev server host", "127.0.0.1")
  .action(async (opts) => {
    console.log("");
    console.log(
      chalk.bold.magenta("  ✨ OpenMagic") + chalk.dim(` v${VERSION}`)
    );
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
        // Re-detect after starting
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
    const token = generateSessionToken();

    // Find available proxy port
    let proxyPort = parseInt(opts.listen, 10);
    if (await isPortOpen(proxyPort)) {
      proxyPort = await findAvailablePort(proxyPort);
    }

    // Start the OpenMagic server (serves toolbar + WebSocket)
    const { httpServer: omServer } = createOpenMagicServer(proxyPort, roots);
    omServer.listen(proxyPort + 1, "127.0.0.1", () => {
      // OpenMagic API/WS server running on proxyPort+1
    });

    // Start the proxy server
    const proxyServer = createProxyServer(
      targetHost,
      targetPort!,
      proxyPort + 1
    );

    proxyServer.listen(proxyPort, "127.0.0.1", () => {
      console.log("");
      console.log(
        chalk.bold.green(`  🚀 Proxy running at → `) +
          chalk.bold.underline.cyan(`http://localhost:${proxyPort}`)
      );
      console.log("");
      console.log(
        chalk.dim("  Open the URL above in your browser to start.")
      );
      console.log(chalk.dim("  Press Ctrl+C to stop."));
      console.log("");

      if (opts.open !== false) {
        open(`http://localhost:${proxyPort}`).catch(() => {
          // Silently fail if browser can't be opened
        });
      }
    });

    // Handle WebSocket upgrades for OpenMagic
    proxyServer.on("upgrade", (req, socket, head) => {
      if (req.url?.startsWith("/__openmagic__")) {
        omServer.emit("upgrade", req, socket, head);
      }
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log("");
      console.log(chalk.dim("  Shutting down OpenMagic..."));
      proxyServer.close();
      omServer.close();
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

  const child = spawn("npm", ["run", chosen.name], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    shell: true,
    env: {
      ...process.env,
      PORT: String(port),       // CRA, Express
      BROWSER: "none",          // Prevent CRA from opening browser
      BROWSER_NONE: "true",     // Some frameworks
    },
  });

  // Pipe child output with prefix
  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(chalk.dim(`  │ ${line}\n`));
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(chalk.dim(`  │ ${line}\n`));
      }
    }
  });

  child.on("error", (err) => {
    console.log(chalk.red(`  ✗  Failed to start: ${err.message}`));
  });

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.log(chalk.red(`  ✗  Dev server exited with code ${code}`));
    }
  });

  // Clean up child on exit
  const cleanup = () => {
    try {
      child.kill("SIGTERM");
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for the port to open
  console.log(
    chalk.dim(`  Waiting for port ${port}...`)
  );

  const isUp = await waitForPort(port, 30000);

  if (!isUp) {
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
