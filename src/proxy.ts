import http from "node:http";
import httpProxy from "http-proxy";
import { getSessionToken } from "./security.js";
import { attachOpenMagic } from "./server.js";

/**
 * Create a single-port proxy server that:
 * 1. Serves /__openmagic__/* (toolbar bundle, health, WebSocket)
 * 2. Proxies everything else to the dev server
 * 3. Injects the toolbar script into HTML responses
 */
export function createProxyServer(
  targetHost: string,
  targetPort: number,
  roots: string[]
): http.Server {
  const proxy = httpProxy.createProxyServer({
    target: `http://${targetHost}:${targetPort}`,
    selfHandleResponse: true,
    changeOrigin: true, // Rewrite Host header to match upstream — required by Vite 5.4+ and some Next.js setups
    // ws: false — we handle WebSocket upgrades manually in server.on("upgrade")
  });

  const token = getSessionToken();

  // Strip Accept-Encoding on HTML requests so upstream sends uncompressed (enables streaming injection)
  // Only apply to regular HTTP requests, not WebSocket upgrades
  proxy.on("proxyReq", (proxyReq, req) => {
    const accept = req.headers.accept || "";
    // Only strip for requests that might return HTML (not for API calls, assets, WS upgrades)
    if (accept.includes("text/html") || accept.includes("*/*") || !accept) {
      proxyReq.removeHeader("Accept-Encoding");
    }
  });

  proxy.on("proxyRes", (proxyRes, req, res) => {
    const contentType = proxyRes.headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");
    const status = proxyRes.statusCode || 200;

    if (!isHtml && status < 400) {
      // Non-HTML success: pass through unchanged
      res.writeHead(status, proxyRes.headers);
      proxyRes.on("error", () => { try { res.end(); } catch {} });
      proxyRes.pipe(res);
      return;
    }

    if (isHtml) {
      // HTML response: stream through and append toolbar script
      const headers = { ...proxyRes.headers };
      delete headers["content-length"];
      delete headers["content-encoding"];
      delete headers["transfer-encoding"];
      delete headers["content-security-policy"];
      delete headers["content-security-policy-report-only"];
      delete headers["x-content-security-policy"];
      delete headers["etag"];
      delete headers["last-modified"];
      headers["cache-control"] = "no-store";

      res.writeHead(status, headers);
      proxyRes.on("error", () => { try { res.end(buildInjectionScript(token)); } catch {} });
      proxyRes.pipe(res, { end: false });
      proxyRes.on("end", () => {
        res.end(buildInjectionScript(token));
      });
      return;
    }

    // Non-HTML error (4xx/5xx) — wrap in HTML with toolbar so user can still interact
    const chunks: Buffer[] = [];
    let totalSize = 0;
    proxyRes.on("data", (c: Buffer) => { if (totalSize < 16384) { chunks.push(c); totalSize += c.length; } });
    proxyRes.on("error", () => { try { res.end(); } catch {} });
    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8").slice(0, 2000);
      const toolbarScript = buildInjectionScript(token);
      res.writeHead(status, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      res.end(`<html><head><meta charset="utf-8"><title>Error ${status}</title></head>
<body style="font-family:system-ui;padding:40px;background:#0f0f1e;color:#e0e0e0;">
<h2 style="color:#e94560;">Error ${status}</h2>
<pre style="color:#888;white-space:pre-wrap;max-width:800px;overflow:auto;font-size:13px;">${body.replace(/</g,"&lt;")}</pre>
<p style="color:#555;font-size:13px;">This error is from your dev server, not OpenMagic. The toolbar is available below.</p>
${toolbarScript}
</body></html>`);
    });
  });

  proxy.on("error", (err, _req, res) => {
    if (res instanceof http.ServerResponse && !res.headersSent) {
      const toolbarScript = buildInjectionScript(token);
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:system-ui;padding:40px;background:#1a1a2e;color:#e0e0e0;">
          <h2 style="color:#e94560;">OpenMagic — Cannot connect to dev server</h2>
          <p>Could not reach <code>${targetHost}:${targetPort}</code></p>
          <p style="color:#888;">Make sure your dev server is running, then refresh this page.</p>
          <p style="color:#666;font-size:13px;">${err.message}</p>
          ${toolbarScript}
        </body></html>`
      );
    } else if (res && typeof (res as any).destroy === "function") {
      // WebSocket socket error — destroy cleanly
      try { (res as any).destroy(); } catch {}
    }
  });

  // Shared references — set after server creation
  let omHandle: ((req: http.IncomingMessage, res: http.ServerResponse) => boolean) | null = null;
  let omUpgrade: ((req: http.IncomingMessage, socket: any, head: Buffer) => boolean) | null = null;

  const server = http.createServer((req, res) => {
    if (omHandle && omHandle(req, res)) return;
    proxy.web(req, res);
  });

  // Attach OpenMagic endpoints to THIS server (same port, noServer WSS)
  const om = attachOpenMagic(server, roots);
  omHandle = om.handleRequest;
  omUpgrade = om.handleUpgrade;

  // Single upgrade handler — OpenMagic WS first, everything else to dev server
  server.on("upgrade", (req, socket, head) => {
    // Try OpenMagic WebSocket first
    if (omUpgrade && omUpgrade(req, socket, head)) return;
    // Everything else (HMR, hot reload, etc.) forwarded to dev server
    proxy.ws(req, socket, head);
  });

  return server;
}

// Same-origin injection — toolbar.js and WS served from THIS server
function buildInjectionScript(token: string): string {
  void token;
  return `<script src="/__openmagic__/toolbar.js?v=${Date.now()}" data-openmagic="true" defer></script>`;
}
