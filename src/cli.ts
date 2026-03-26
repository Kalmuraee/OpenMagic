import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import { resolve } from "node:path";
import { createProxyServer } from "./proxy.js";
import { createOpenMagicServer } from "./server.js";
import { generateSessionToken } from "./security.js";
import { detectDevServer, findAvailablePort, isPortOpen } from "./detect.js";
import { loadConfig, saveConfig } from "./config.js";

const VERSION = "0.1.0";

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

    // Determine target dev server
    let targetPort: number;
    let targetHost = opts.host;

    if (opts.port) {
      targetPort = parseInt(opts.port, 10);
      const isRunning = await isPortOpen(targetPort);
      if (!isRunning) {
        console.log(
          chalk.yellow(
            `  ⚠  No server found at ${targetHost}:${targetPort}`
          )
        );
        console.log(
          chalk.dim(
            "     Start your dev server first, then run openmagic again."
          )
        );
        console.log("");
        process.exit(1);
      }
    } else {
      console.log(chalk.dim("  Scanning for dev server..."));
      const detected = await detectDevServer();
      if (!detected) {
        console.log(
          chalk.yellow(
            "  ⚠  No dev server detected on common ports (3000, 5173, 8080, etc.)"
          )
        );
        console.log("");
        console.log(
          chalk.white("  Specify the port manually:")
        );
        console.log(
          chalk.cyan("    npx openmagic --port 3000")
        );
        console.log("");
        process.exit(1);
      }
      targetPort = detected.port;
      targetHost = detected.host;
    }

    console.log(
      chalk.green(`  ✓  Dev server found at ${targetHost}:${targetPort}`)
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
      targetPort,
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
        // Forward to OpenMagic WS server
        omServer.emit("upgrade", req, socket, head);
      }
      // Otherwise, the proxy.ts handler forwards to dev server
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

program.parse();
