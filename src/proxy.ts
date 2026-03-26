import http from "node:http";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import httpProxy from "http-proxy";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliAsync = promisify(brotliDecompress);
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

    // For HTML responses, collect the body, decompress if needed, and inject toolbar
    collectBody(proxyRes)
      .then((body) => {
        // Inject toolbar script before </body> or at end
        const toolbarScript = buildInjectionScript(serverPort, token);
        if (body.includes("</body>")) {
          body = body.replace("</body>", `${toolbarScript}</body>`);
        } else if (body.includes("</html>")) {
          body = body.replace("</html>", `${toolbarScript}</html>`);
        } else {
          body += toolbarScript;
        }

        // Send uncompressed response (we decoded it)
        const headers = { ...proxyRes.headers };
        delete headers["content-length"];
        delete headers["content-encoding"];
        delete headers["transfer-encoding"];
        delete headers["content-security-policy"];
        delete headers["content-security-policy-report-only"];
        delete headers["x-content-security-policy"];
        delete headers["etag"];
        delete headers["last-modified"];

        res.writeHead(proxyRes.statusCode || 200, headers);
        res.end(body);
      })
      .catch(() => {
        // If decompression/collection fails, proxy the raw response
        // This ensures the app still works even if injection fails
        try {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          res.end();
        } catch {
          // Response already sent or connection closed
        }
      });
  });

  proxy.on("error", (err, _req, res) => {
    if (res instanceof http.ServerResponse && !res.headersSent) {
      const toolbarScript = buildInjectionScript(serverPort, token);
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

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/__openmagic__/")) {
      handleToolbarAsset(req, res, serverPort);
      return;
    }
    proxy.web(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/__openmagic__")) {
      return;
    }
    proxy.ws(req, socket, head);
  });

  return server;
}

async function collectBody(stream: http.IncomingMessage): Promise<string> {
  // Buffer raw data first, then decompress — avoids consumed-stream problem
  const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  const encoding = (stream.headers["content-encoding"] || "").toLowerCase();

  if (!encoding || encoding === "identity") {
    return rawBuffer.toString("utf-8");
  }

  // Try decompression — fall back to raw on failure
  try {
    let decompressed: Buffer;
    if (encoding === "gzip" || encoding === "x-gzip") {
      decompressed = await gunzipAsync(rawBuffer);
    } else if (encoding === "deflate") {
      decompressed = await inflateAsync(rawBuffer);
    } else if (encoding === "br") {
      decompressed = await brotliAsync(rawBuffer);
    } else {
      return rawBuffer.toString("utf-8");
    }
    return decompressed.toString("utf-8");
  } catch {
    // Decompression failed — try raw (might be uncompressed despite header)
    return rawBuffer.toString("utf-8");
  }
}

function handleToolbarAsset(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  _serverPort: number
): void {
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
