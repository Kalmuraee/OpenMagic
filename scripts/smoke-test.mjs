import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "openmagic-smoke-"));
let cli;
let fixture;

try {
  writeFileSync(join(tempDir, "index.html"), "<!doctype html><html><head><title>Smoke</title></head><body><main id=\"app\">OpenMagic smoke fixture</main></body></html>");

  fixture = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><html><head><title>Smoke</title></head><body><main id=\"app\">OpenMagic smoke fixture</main></body></html>");
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await listen(fixture, 0);
  const targetPort = fixture.address().port;
  const proxyPort = await getFreePort();

  cli = spawn(process.execPath, [
    "dist/cli.js",
    "--port", String(targetPort),
    "--listen", String(proxyPort),
    "--root", tempDir,
    "--host", "127.0.0.1",
    "--no-open",
  ], {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  cli.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  cli.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  await waitFor(async () => {
    const response = await fetch(`http://localhost:${proxyPort}/__openmagic__/health`);
    return response.ok;
  }, 20_000, () => logs.join(""));

  const html = await text(`http://localhost:${proxyPort}/`);
  if (!html.includes("/__openmagic__/toolbar.js")) {
    throw new Error("Proxied HTML did not include the toolbar script");
  }

  const toolbar = await text(`http://localhost:${proxyPort}/__openmagic__/toolbar.js`);
  if (!toolbar.includes("(function(__OPENMAGIC_TOKEN__)")) {
    throw new Error("Toolbar bundle is not wrapped with a private token argument");
  }
  if (toolbar.includes("const __OPENMAGIC_TOKEN__")) {
    throw new Error("Toolbar bundle exposes a top-level token binding");
  }

  const toolbarPath = join(tempDir, "toolbar.js");
  writeFileSync(toolbarPath, toolbar);
  const check = spawnSync(process.execPath, ["--check", toolbarPath], { encoding: "utf8" });
  if (check.status !== 0) {
    throw new Error(`Toolbar bundle failed syntax check:\n${check.stderr || check.stdout}`);
  }

  console.log("OpenMagic smoke test passed");
} finally {
  if (cli && !cli.killed) cli.kill("SIGKILL");
  await closeServer(fixture);
  rmSync(tempDir, { recursive: true, force: true });
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

async function getFreePort() {
  const server = http.createServer();
  await listen(server, 0);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose) => server.close(resolveClose));
}

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function waitFor(fn, timeoutMs, getDebug) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await fn()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  const detail = getDebug ? `\n${getDebug()}` : "";
  throw new Error(`Timed out waiting for OpenMagic proxy${lastError ? `: ${lastError.message}` : ""}${detail}`);
}
