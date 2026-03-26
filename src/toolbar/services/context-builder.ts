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

// --- Context Builder ---

export function buildContext(
  selectedElement: SelectedElement | null,
  screenshot: string | null
) {
  return {
    selectedElement: selectedElement
      ? {
          tagName: selectedElement.tagName,
          id: selectedElement.id,
          className: selectedElement.className,
          textContent: selectedElement.textContent,
          outerHTML: selectedElement.outerHTML,
          cssSelector: selectedElement.cssSelector,
          computedStyles: selectedElement.computedStyles,
        }
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
  };
}
