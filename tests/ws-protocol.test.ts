import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachOpenMagic } from "../src/server.js";
import { generateSessionToken } from "../src/security.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

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

async function createProtocolServer(root: string): Promise<{ port: number; server: http.Server; token: string }> {
  const token = generateSessionToken();
  const server = http.createServer();
  const om = attachOpenMagic(server, [root]);
  server.on("request", (req, res) => {
    if (!om.handleRequest(req, res)) {
      res.writeHead(404).end();
    }
  });
  server.on("upgrade", (req, socket, head) => {
    if (!om.handleUpgrade(req, socket, head)) socket.destroy();
  });
  return { port: await listen(server), server, token };
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__openmagic__/ws`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function readWs(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

describe("OpenMagic WebSocket protocol", () => {
  it("accepts a valid handshake and routes authenticated messages", async () => {
    const root = mkdtempSync(join(tmpdir(), "openmagic-ws-"));
    tmpRoots.push(root);
    writeFileSync(join(root, "hello.txt"), "hello");
    const { port, server, token } = await createProtocolServer(root);
    const ws = await connectWs(port);

    try {
      ws.send(JSON.stringify({ id: "handshake", type: "handshake", payload: { token } }));
      await expect(readWs(ws)).resolves.toMatchObject({ id: "handshake", type: "handshake.ok" });

      ws.send(JSON.stringify({ id: "read", type: "fs.read", payload: { path: join(root, "hello.txt") } }));
      await expect(readWs(ws)).resolves.toMatchObject({
        id: "read",
        type: "fs.content",
        payload: { content: "hello" },
      });
    } finally {
      ws.close();
      await close(server);
    }
  });

  it("rejects invalid tokens and unauthenticated operations", async () => {
    const root = mkdtempSync(join(tmpdir(), "openmagic-ws-"));
    tmpRoots.push(root);
    const { port, server } = await createProtocolServer(root);
    const ws = await connectWs(port);

    try {
      ws.send(JSON.stringify({ id: "read", type: "fs.list", payload: {} }));
      await expect(readWs(ws)).resolves.toMatchObject({
        id: "read",
        type: "error",
        payload: { code: "auth_required" },
      });

      ws.send(JSON.stringify({ id: "bad", type: "handshake", payload: { token: "bad" } }));
      await expect(readWs(ws)).resolves.toMatchObject({
        id: "bad",
        type: "error",
        payload: { code: "auth_failed" },
      });
    } finally {
      ws.close();
      await close(server);
    }
  });

  it("rejects unknown authenticated message types", async () => {
    const root = mkdtempSync(join(tmpdir(), "openmagic-ws-"));
    tmpRoots.push(root);
    const { port, server, token } = await createProtocolServer(root);
    const ws = await connectWs(port);

    try {
      ws.send(JSON.stringify({ id: "handshake", type: "handshake", payload: { token } }));
      await readWs(ws);

      ws.send(JSON.stringify({ id: "unknown", type: "unknown.type", payload: {} }));
      await expect(readWs(ws)).resolves.toMatchObject({
        id: "unknown",
        type: "error",
        payload: { code: "unknown_type" },
      });
    } finally {
      ws.close();
      await close(server);
    }
  });
});
