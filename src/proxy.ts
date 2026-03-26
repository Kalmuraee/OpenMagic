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
    ws: true,
    selfHandleResponse: true,
  });

  const token = getSessionToken();

  // Strip Accept-Encoding so upstream sends uncompressed HTML (enables streaming injection)
  proxy.on("proxyReq", (proxyReq) => {
    proxyReq.removeHeader("Accept-Encoding");
  });

  proxy.on("proxyRes", (proxyRes, req, res) => {
    const contentType = proxyRes.headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");

    if (!isHtml) {
      // Non-HTML: pass through unchanged
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // HTML: stream through and append toolbar script at the end
    const headers = { ...proxyRes.headers };
    delete headers["content-length"]; // Length will change
    delete headers["content-encoding"]; // We stripped Accept-Encoding
    delete headers["transfer-encoding"];
    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    delete headers["x-content-security-policy"];
    delete headers["etag"];
    delete headers["last-modified"];
    headers["cache-control"] = "no-store";

    res.writeHead(proxyRes.statusCode || 200, headers);

    // Stream the response body through
    proxyRes.pipe(res, { end: false });

    // When the upstream finishes, append the toolbar script
    proxyRes.on("end", () => {
      res.end(buildInjectionScript(token));
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
    }
  });

  // Shared reference for the handler — set after server creation
  let omHandle: ((req: http.IncomingMessage, res: http.ServerResponse) => boolean) | null = null;

  const server = http.createServer((req, res) => {
    if (omHandle && omHandle(req, res)) return;
    proxy.web(req, res);
  });

  // Attach OpenMagic WS + endpoints to THIS server (same port)
  const om = attachOpenMagic(server, roots);
  omHandle = om.handleRequest;

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    // OpenMagic WS is handled by the WSS attached to this server
    if (req.url?.startsWith("/__openmagic__")) return;
    // Everything else (HMR, etc.) goes to dev server
    proxy.ws(req, socket, head);
  });

  return server;
}

// Same-origin injection — toolbar.js and WS served from THIS server
function buildInjectionScript(token: string): string {
  return `<script src="/__openmagic__/toolbar.js?v=${Date.now()}" data-openmagic="true" data-openmagic-token="${token}" defer></script>`;
}
