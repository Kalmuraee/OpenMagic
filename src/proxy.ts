import http from "node:http";
import httpProxy from "http-proxy";
import { getSessionToken } from "./security.js";

export function createProxyServer(
  targetHost: string,
  targetPort: number,
  serverPort: number
): http.Server {
  const proxy = httpProxy.createProxyServer({
    target: `http://${targetHost}:${targetPort}`,
    ws: true,
    selfHandleResponse: true,
  });

  const token = getSessionToken();

  proxy.on("proxyRes", (proxyRes, req, res) => {
    const contentType = proxyRes.headers["content-type"] || "";
    const isHtml = contentType.includes("text/html");

    if (!isHtml) {
      // Pass through non-HTML responses unchanged
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // For HTML responses, collect the body and inject the toolbar script
    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on("end", () => {
      let body = Buffer.concat(chunks).toString("utf-8");

      // Inject toolbar script before </body> or at end
      const toolbarScript = buildInjectionScript(serverPort, token);
      if (body.includes("</body>")) {
        body = body.replace("</body>", `${toolbarScript}</body>`);
      } else if (body.includes("</html>")) {
        body = body.replace("</html>", `${toolbarScript}</html>`);
      } else {
        body += toolbarScript;
      }

      // Remove content-length since we modified the body
      const headers = { ...proxyRes.headers };
      delete headers["content-length"];
      delete headers["content-encoding"]; // Remove compression since we decoded it

      res.writeHead(proxyRes.statusCode || 200, headers);
      res.end(body);
    });
  });

  proxy.on("error", (err, _req, res) => {
    console.error("[OpenMagic] Proxy error:", err.message);
    if (res instanceof http.ServerResponse && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(
        `OpenMagic proxy error: Could not connect to dev server at ${targetHost}:${targetPort}\n\nMake sure your dev server is running.`
      );
    }
  });

  const server = http.createServer((req, res) => {
    // Serve toolbar assets from /__openmagic__/ path
    if (req.url?.startsWith("/__openmagic__/")) {
      handleToolbarAsset(req, res, serverPort);
      return;
    }

    // Proxy everything else to the dev server
    proxy.web(req, res);
  });

  // Handle WebSocket upgrades — forward to dev server (for HMR etc.)
  server.on("upgrade", (req, socket, head) => {
    // Don't proxy OpenMagic WebSocket connections
    if (req.url?.startsWith("/__openmagic__")) {
      return; // Let the WS server handle this
    }
    proxy.ws(req, socket, head);
  });

  return server;
}

function handleToolbarAsset(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _serverPort: number
): void {
  // The toolbar bundle is served inline via the injection script
  // This endpoint exists for potential future asset serving (icons, fonts, etc.)
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

function buildInjectionScript(serverPort: number, token: string): string {
  return `
<script data-openmagic="true">
(function() {
  if (window.__OPENMAGIC_LOADED__) return;
  window.__OPENMAGIC_LOADED__ = true;
  window.__OPENMAGIC_CONFIG__ = {
    wsPort: ${serverPort},
    token: "${token}"
  };
  var script = document.createElement("script");
  script.src = "http://127.0.0.1:${serverPort}/__openmagic__/toolbar.js";
  script.dataset.openmagic = "true";
  document.body.appendChild(script);
})();
</script>`;
}
