import http from "node:http";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createProxyServer } from "../src/proxy.js";
import { generateSessionToken } from "../src/security.js";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function wsMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try { resolve(JSON.parse(data.toString())); } catch { resolve(data.toString()); }
    });
    ws.once("error", reject);
  });
}

async function withProxy<T>(fn: (url: string, port: number) => Promise<T>): Promise<T> {
  const upstream = http.createServer((req, res) => {
    if (req.url === "/asset.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end("window.assetLoaded = true;");
      return;
    }
    if (req.url === "/bad") {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("<boom>");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy": "default-src 'self'",
    });
    res.end("<html><body>Hello</body></html>");
  });

  const upstreamWs = new WebSocketServer({ noServer: true });
  upstream.on("upgrade", (req, socket, head) => {
    if (req.url === "/hmr") {
      upstreamWs.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ type: "dev-server-ws" }));
      });
    } else {
      socket.destroy();
    }
  });

  const upstreamPort = await listen(upstream);
  generateSessionToken();
  const proxy = createProxyServer("127.0.0.1", upstreamPort, [process.cwd()]);
  const proxyPort = await listen(proxy);

  try {
    return await fn(`http://127.0.0.1:${proxyPort}`, proxyPort);
  } finally {
    upstreamWs.close();
    await close(proxy);
    await close(upstream);
  }
}

describe("proxy injection", () => {
  it("injects toolbar script into HTML and strips CSP", async () => {
    await withProxy(async (url) => {
      const response = await fetch(url);
      const body = await response.text();

      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(body).toContain("/__openmagic__/toolbar.js");
      expect(body).toContain("OpenMagic runs inside this local page");
    });
  });

  it("passes non-HTML success responses through unchanged", async () => {
    await withProxy(async (url) => {
      const response = await fetch(`${url}/asset.js`);
      const body = await response.text();

      expect(response.headers.get("content-type")).toContain("application/javascript");
      expect(body).toBe("window.assetLoaded = true;");
    });
  });

  it("wraps non-HTML server errors with toolbar HTML", async () => {
    await withProxy(async (url) => {
      const response = await fetch(`${url}/bad`);
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(body).toContain("Error 500");
      expect(body).toContain("&lt;boom>");
      expect(body).toContain("/__openmagic__/toolbar.js");
    });
  });
});

describe("proxy WebSocket routing", () => {
  it("routes OpenMagic and dev-server WebSocket upgrades separately", async () => {
    await withProxy(async (_url, port) => {
      const devWs = new WebSocket(`ws://127.0.0.1:${port}/hmr`);
      await expect(wsMessage(devWs)).resolves.toEqual({ type: "dev-server-ws" });
      devWs.close();

      const token = generateSessionToken();
      const omWs = new WebSocket(`ws://127.0.0.1:${port}/__openmagic__/ws`);
      await new Promise((resolve) => omWs.once("open", resolve));
      omWs.send(JSON.stringify({ id: "1", type: "handshake", payload: { token } }));
      await expect(wsMessage(omWs)).resolves.toMatchObject({ id: "1", type: "handshake.ok" });
      omWs.close();
    });
  });
});
