
import http from "node:http";
import httpProxy from "http-proxy";
import { getSessionToken } from "./security.js";
import { attachOpenMagic } from "./server.js";

export function createProxyServer(targetHost: string, targetPort: number, roots: string[]): http.Server {
  const proxy = httpProxy.createProxyServer({
    target: `http://${targetHost}:${targetPort}`,
    selfHandleResponse: true,
    changeOrigin: true,
  });
  const token = getSessionToken();

  proxy.on("proxyReq", (proxyReq, req) => {
    const accept = req.headers.accept || "";
    if (accept.includes("text/html")) proxyReq.removeHeader("Accept-Encoding");
  });

  proxy.on("proxyRes", (proxyRes, _req, res) => {
    const contentType = String(proxyRes.headers["content-type"] || "");
    const isHtml = contentType.includes("text/html");
    const status = proxyRes.statusCode || 200;
    const encoding = String(proxyRes.headers["content-encoding"] || "").toLowerCase();

    // API/XHR/static responses — including 4xx/5xx — must remain byte-for-byte
    // compatible with the application. Never turn JSON validation errors into HTML.
    if (!isHtml || encoding) {
      res.writeHead(status, proxyRes.headers);
      proxyRes.on("error", () => { try { res.end(); } catch {} });
      proxyRes.pipe(res);
      return;
    }

    const headers = { ...proxyRes.headers };
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    delete headers["x-content-security-policy"];
    delete headers.etag;
    delete headers["last-modified"];
    headers["cache-control"] = "no-store";

    res.writeHead(status, headers);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      try { res.end(buildInjectionScript(token)); } catch {}
    };
    proxyRes.on("error", finish);
    proxyRes.pipe(res, { end: false });
    proxyRes.on("end", finish);
  });

  proxy.on("error", (error, _req, res) => {
    if (res instanceof http.ServerResponse && !res.headersSent) {
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      res.writeHead(502, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      res.end(`<html><body style="font-family:system-ui;padding:40px;background:#1a1a2e;color:#e0e0e0;">
        <h2 style="color:#e94560;">OpenMagic — Cannot connect to dev server</h2>
        <p>Could not reach <code>${escape(`${targetHost}:${targetPort}`)}</code></p>
        <p style="color:#888;">Make sure your dev server is running, then refresh this page.</p>
        <p style="color:#666;font-size:13px;">${escape(error.message)}</p>
        ${buildInjectionScript(token)}
      </body></html>`);
    } else if (res && typeof (res as { destroy?: () => void }).destroy === "function") {
      try { (res as { destroy: () => void }).destroy(); } catch {}
    }
  });

  let omHandle: ((req: http.IncomingMessage, res: http.ServerResponse) => boolean) | null = null;
  let omUpgrade: ((req: http.IncomingMessage, socket: unknown, head: Buffer) => boolean) | null = null;
  const server = http.createServer((req, res) => {
    if (omHandle?.(req, res)) return;
    proxy.web(req, res);
  });
  const om = attachOpenMagic(server, roots);
  omHandle = om.handleRequest;
  omUpgrade = om.handleUpgrade;
  server.on("upgrade", (req, socket, head) => {
    if (omUpgrade?.(req, socket, head)) return;
    proxy.ws(req, socket, head);
  });
  return server;
}

export function buildInjectionScript(_token: string): string {
  return `<script data-openmagic-warning="true">(function(){queueMicrotask(function(){try{var scripts=[].slice.call(document.scripts||[]);var third=scripts.filter(function(s){if(!s.src)return false;var u=new URL(s.src,location.href);return u.origin!==location.origin&&!u.pathname.startsWith("/__openmagic__/");});if(third.length){console.warn("OpenMagic runs inside this local page. Avoid using it with untrusted third-party scripts.");}}catch(e){}});})();</script><script src="/__openmagic__/toolbar.js?v=${Date.now()}" data-openmagic="true" defer></script>`;
}
