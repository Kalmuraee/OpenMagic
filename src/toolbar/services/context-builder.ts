import type { SelectedElement } from "./dom-inspector.js";

// --- Network Log Capture ---

interface NetworkEntry {
  method: string;
  url: string;
  status?: number;
  duration?: number;
  timestamp: number;
}

const networkLogs: NetworkEntry[] = [];
const MAX_NETWORK_LOGS = 50;

let networkCaptureInstalled = false;

export function installNetworkCapture(): void {
  if (networkCaptureInstalled) return;
  networkCaptureInstalled = true;

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = new Request(...args);
    const entry: NetworkEntry = {
      method: request.method,
      url: request.url,
      timestamp: Date.now(),
    };

    try {
      const response = await originalFetch.apply(this, args);
      entry.status = response.status;
      entry.duration = Date.now() - entry.timestamp;
      addNetworkEntry(entry);
      return response;
    } catch (e) {
      entry.status = 0;
      entry.duration = Date.now() - entry.timestamp;
      addNetworkEntry(entry);
      throw e;
    }
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
    (this as any).__om_method = method;
    (this as any).__om_url = url;
    (this as any).__om_start = Date.now();
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("loadend", () => {
      addNetworkEntry({
        method: (this as any).__om_method || "GET",
        url: (this as any).__om_url || "",
        status: this.status,
        duration: Date.now() - ((this as any).__om_start || Date.now()),
        timestamp: (this as any).__om_start || Date.now(),
      });
    });
    return originalSend.apply(this, args);
  };
}

function addNetworkEntry(entry: NetworkEntry): void {
  // Filter out OpenMagic's own requests
  if (entry.url.includes("__openmagic__")) return;
  networkLogs.push(entry);
  if (networkLogs.length > MAX_NETWORK_LOGS) {
    networkLogs.shift();
  }
}

export function getNetworkLogs(): NetworkEntry[] {
  return [...networkLogs];
}

export function clearNetworkLogs(): void {
  networkLogs.length = 0;
}

// --- Console Log Capture ---

interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  args: string[];
  timestamp: number;
}

const consoleLogs: ConsoleEntry[] = [];
const MAX_CONSOLE_LOGS = 100;

let consoleCaptureInstalled = false;

export function installConsoleCapture(): void {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;

  const levels: ConsoleEntry["level"][] = ["log", "warn", "error", "info", "debug"];

  for (const level of levels) {
    const original = console[level];
    console[level] = function (...args: any[]) {
      consoleLogs.push({
        level,
        args: args.map((a) => {
          try {
            return typeof a === "object" ? JSON.stringify(a).slice(0, 500) : String(a);
          } catch {
            return String(a);
          }
        }),
        timestamp: Date.now(),
      });

      if (consoleLogs.length > MAX_CONSOLE_LOGS) {
        consoleLogs.shift();
      }

      original.apply(console, args);
    };
  }
}

export function getConsoleLogs(): ConsoleEntry[] {
  return [...consoleLogs];
}

export function clearConsoleLogs(): void {
  consoleLogs.length = 0;
}

// --- Runtime Error Capture (H7) ---
// Uncaught errors and unhandled rejections — the only signal that catches
// "compiled fine but white-screened at runtime". Plus a scrape of the framework
// error overlay (Next.js / Vite / webpack) which shows the real stack.

interface RuntimeErrorEntry {
  type: "error" | "unhandledrejection" | "overlay";
  message: string;
  source?: string;
  stack?: string;
  timestamp: number;
}

const runtimeErrors: RuntimeErrorEntry[] = [];
const MAX_RUNTIME_ERRORS = 30;
let runtimeCaptureInstalled = false;

function addRuntimeError(entry: RuntimeErrorEntry): void {
  runtimeErrors.push(entry);
  if (runtimeErrors.length > MAX_RUNTIME_ERRORS) runtimeErrors.shift();
}

export function installRuntimeErrorCapture(): void {
  if (runtimeCaptureInstalled || typeof window === "undefined") return;
  runtimeCaptureInstalled = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    const err = e.error as Error | undefined;
    addRuntimeError({
      type: "error",
      message: e.message || String(err?.message || err || "Unknown error"),
      source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
      stack: err?.stack?.slice(0, 1500),
      timestamp: Date.now(),
    });
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason as any;
    addRuntimeError({
      type: "unhandledrejection",
      message: reason?.message ? String(reason.message) : String(reason).slice(0, 500),
      stack: typeof reason?.stack === "string" ? reason.stack.slice(0, 1500) : undefined,
      timestamp: Date.now(),
    });
  });
}

// Read the visible framework error overlay (compiled-but-crashed apps render one).
export function scrapeErrorOverlay(): string | null {
  if (typeof document === "undefined") return null;
  try {
    // Next.js (App & Pages router) renders into a <nextjs-portal> shadow host.
    const nextPortal = document.querySelector("nextjs-portal");
    const nextText = (nextPortal as any)?.shadowRoot?.textContent?.trim();
    if (nextText) return nextText.slice(0, 4000);

    // Vite overlay: <vite-error-overlay> custom element with a shadow root.
    const viteOverlay = document.querySelector("vite-error-overlay");
    const viteText = (viteOverlay as any)?.shadowRoot?.textContent?.trim();
    if (viteText) return viteText.slice(0, 4000);

    // webpack-dev-server overlay iframe/container.
    const webpackOverlay = document.querySelector("#webpack-dev-server-client-overlay, #react-refresh-overlay");
    const webpackText = webpackOverlay?.textContent?.trim();
    if (webpackText) return webpackText.slice(0, 4000);
  } catch {
    // overlay shape varies across versions — best-effort only
  }
  return null;
}

export function getRuntimeErrors(): RuntimeErrorEntry[] {
  const list = [...runtimeErrors];
  const overlay = scrapeErrorOverlay();
  if (overlay) list.push({ type: "overlay", message: overlay, timestamp: Date.now() });
  return list;
}

export function clearRuntimeErrors(): void {
  runtimeErrors.length = 0;
}

/**
 * Phase 6: condense a post-reload runtime failure into a short summary for the
 * self-correct loop, or null if there's no failure signal. Inputs are already
 * filtered to real signals — a framework error overlay and uncaught
 * errors/rejections (not ordinary console logs).
 */
export function summarizeRuntimeFailure(
  overlayText: string | null,
  runtimeErrors: Array<{ type: string; message: string; source?: string; stack?: string }>
): string | null {
  const parts: string[] = [];
  if (overlayText) parts.push(overlayText.slice(0, 1500));
  for (const e of runtimeErrors) {
    if (e.type === "overlay") continue; // already covered by overlayText
    parts.push(`[${e.type}] ${e.message}${e.source ? ` (${e.source})` : ""}`);
  }
  const summary = parts.join("\n").trim();
  return summary ? summary.slice(0, 2000) : null;
}

// --- Context Builder ---

// Forward the whole captured element (H2: the prompt reads ~20 fields, not the 7
// we used to send), capping the largest free-text fields so the prompt stays bounded.
function forwardElement(el: SelectedElement): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(el as unknown as Record<string, unknown>) };
  if (typeof out.outerHTML === "string" && out.outerHTML.length > 8000) {
    out.outerHTML = out.outerHTML.slice(0, 8000) + " …[truncated]";
  }
  if (typeof out.textContent === "string" && out.textContent.length > 2000) {
    out.textContent = out.textContent.slice(0, 2000) + " …[truncated]";
  }
  return out;
}

export function buildContext(
  selectedElement: SelectedElement | null,
  screenshot: string | null,
  selectedElements?: SelectedElement[]
) {
  return {
    selectedElement: selectedElement ? forwardElement(selectedElement) : undefined,
    // U3: forward the full multi-selection (only when more than one) so the model
    // can reason about all chosen elements, not just the primary.
    selectedElements: selectedElements && selectedElements.length > 1
      ? selectedElements.map(forwardElement)
      : undefined,
    screenshot: screenshot || undefined,
    networkLogs: getNetworkLogs().map((l) => ({
      method: l.method,
      url: l.url,
      status: l.status,
      duration: l.duration,
      timestamp: l.timestamp,
    })),
    consoleLogs: getConsoleLogs().map((l) => ({
      level: l.level,
      args: l.args,
      timestamp: l.timestamp,
    })),
    runtimeErrors: getRuntimeErrors().map((e) => ({
      type: e.type,
      message: e.message,
      source: e.source,
      stack: e.stack,
      timestamp: e.timestamp,
    })),
  };
}
