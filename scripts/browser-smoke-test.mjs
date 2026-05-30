import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "openmagic-browser-smoke-"));
let cli;
let fixture;
let browser;

try {
  writeFileSync(join(tempDir, "package.json"), JSON.stringify({ dependencies: { react: "19.0.0" } }));
  writeFileSync(join(tempDir, "src-App.tsx"), "export function App(){ return <button>Smoke</button>; }\n");
  mkdirSync(join(tempDir, ".openmagic"), { recursive: true });
  writeFileSync(join(tempDir, ".openmagic", "config.json"), JSON.stringify({ provider: "openai", model: "gpt-5.5" }));

  fixture = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><html><head><title>Browser Smoke</title></head><body><main id=\"app\"><button class=\"primary\">Smoke Button</button></main></body></html>");
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
    env: { ...process.env, FORCE_COLOR: "0", HOME: tempDir, OPENMAGIC_MODEL_CACHE_FILE: join(tempDir, "model-cache.json") },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  cli.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  cli.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  await waitFor(async () => {
    const response = await fetch(`http://localhost:${proxyPort}/__openmagic__/health`);
    return response.ok;
  }, 20_000, () => logs.join(""));

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`http://localhost:${proxyPort}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("openmagic-toolbar", { state: "attached", timeout: 10_000 });

  const toolbar = page.locator("openmagic-toolbar");
  await toolbar.dispatchEvent("openmagic:test-open-settings");

  await page.waitForFunction(() => document.querySelector("openmagic-toolbar")?.getAttribute("data-openmagic-panel") === "settings");
  await page.waitForFunction(() => Number(document.querySelector("openmagic-toolbar")?.getAttribute("data-openmagic-model-count") || "0") > 0);
  const modelIds = await toolbar.getAttribute("data-openmagic-model-ids");
  if (!modelIds?.includes("gpt-5.5")) throw new Error("Server-provided model list did not include GPT-5.5");

  // Visual element editor: open it on the fixture button and verify edits preview
  // LIVE on the real element (the core of the feature). The editor UI lives in a
  // CLOSED shadow root, so we drive it via test-event hooks and assert against the
  // light-DOM element + host attributes (the same pattern as the settings check).
  await page.evaluate(() => {
    document.querySelector("openmagic-toolbar")?.dispatchEvent(
      new CustomEvent("openmagic:test-edit-element", { detail: { selector: "button.primary" } })
    );
  });
  await page.waitForFunction(() => {
    const h = document.querySelector("openmagic-toolbar");
    return h?.getAttribute("data-openmagic-panel") === "edit" && h?.getAttribute("data-openmagic-editing") === "button.primary";
  }, null, { timeout: 10_000 });

  // Live style edit → the real button's inline color updates instantly.
  await page.evaluate(() => {
    document.querySelector("openmagic-toolbar")?.dispatchEvent(
      new CustomEvent("openmagic:test-live-edit", { detail: { kind: "style", name: "color", value: "rgb(255, 0, 0)" } })
    );
  });
  await page.waitForFunction(() => document.querySelector("button.primary")?.style.color === "rgb(255, 0, 0)", null, { timeout: 10_000 });

  // Live text edit → the real button's text updates instantly.
  await page.evaluate(() => {
    document.querySelector("openmagic-toolbar")?.dispatchEvent(
      new CustomEvent("openmagic:test-live-edit", { detail: { kind: "text", value: "Joined!" } })
    );
  });
  await page.waitForFunction(() => document.querySelector("button.primary")?.textContent === "Joined!", null, { timeout: 10_000 });

  // UX/UI review: verify the design-token extraction runs on the real page
  // (the "brand/consistency" context fed to the design review).
  await page.evaluate(() => {
    document.querySelector("openmagic-toolbar")?.dispatchEvent(new CustomEvent("openmagic:test-design-tokens"));
  });
  await page.waitForFunction(() => {
    const raw = document.querySelector("openmagic-toolbar")?.getAttribute("data-openmagic-design-tokens");
    if (!raw) return false;
    const t = JSON.parse(raw);
    return t.colors > 0 && t.fonts > 0 && t.sizes > 0;
  }, null, { timeout: 10_000 });

  if (consoleErrors.length) {
    throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
  }

  console.log("OpenMagic browser smoke test passed (incl. live element-editor preview)");
} finally {
  if (browser) await browser.close().catch(() => {});
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
