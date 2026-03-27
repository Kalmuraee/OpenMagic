import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { validateToken } from "./security.js";
import { loadConfig, saveConfig } from "./config.js";
import { readFileSafe, writeFileSafe, listFiles, getProjectTree } from "./filesystem.js";
import type {
  WsMessage,
  HandshakePayload,
  FsReadPayload,
  FsWritePayload,
  FsListPayload,
  LlmChatPayload,
  ConfigSetPayload,
  OpenMagicConfig,
} from "./shared-types.js";
import { handleLlmChat } from "./llm/proxy.js";
import { MODEL_REGISTRY } from "./llm/registry.js";

const VERSION = "0.24.0";
const __dirname = dirname(fileURLToPath(import.meta.url));

interface ClientState {
  authenticated: boolean;
}

/**
 * Attach OpenMagic endpoints to an existing HTTP server.
 * Handles: toolbar bundle serving, health check, WebSocket.
 * Returns a request handler and the WSS instance.
 */
export function attachOpenMagic(
  httpServer: http.Server,
  roots: string[]
): {
  wss: WebSocketServer;
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
  handleUpgrade: (req: http.IncomingMessage, socket: any, head: Buffer) => boolean;
} {

  // Request handler for /__openmagic__/ paths — returns true if handled
  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!req.url?.startsWith("/__openmagic__/")) return false;

    // Strip query string for path matching (e.g., toolbar.js?v=123)
    const urlPath = req.url.split("?")[0];

    if (urlPath === "/__openmagic__/toolbar.js") {
      serveToolbarBundle(res);
      return true;
    }

    if (urlPath === "/__openmagic__/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ status: "ok", version: VERSION }));
      return true;
    }

    return false;
  }

  // WebSocket server — noServer mode so it doesn't intercept non-OpenMagic upgrades
  const wss = new WebSocketServer({ noServer: true });

  const clientStates = new WeakMap<WebSocket, ClientState>();

  wss.on("connection", (ws, req) => {
    const origin = req.headers.origin || "";
    if (origin && !origin.startsWith("http://localhost") && !origin.startsWith("http://127.0.0.1")) {
      ws.close(4003, "Forbidden origin");
      return;
    }
    clientStates.set(ws, { authenticated: false });

    ws.on("message", async (data) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendError(ws, "parse_error", "Invalid JSON");
        return;
      }

      const state = clientStates.get(ws)!;

      if (!state.authenticated && msg.type !== "handshake") {
        sendError(ws, "auth_required", "Handshake required");
        return;
      }

      try {
        await handleMessage(ws, msg, state, roots);
      } catch (e: unknown) {
        sendError(ws, "internal_error", (e as Error).message, msg.id);
      }
    });

    ws.on("close", () => {
      clientStates.delete(ws);
    });
  });

  // Handle WebSocket upgrades for OpenMagic path only
  function handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): boolean {
    const urlPath = (req.url || "").split("?")[0];
    if (urlPath === "/__openmagic__/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return true;
    }
    return false;
  }

  return { wss, handleRequest, handleUpgrade };
}

async function handleMessage(
  ws: WebSocket,
  msg: WsMessage,
  state: ClientState,
  roots: string[]
): Promise<void> {
  switch (msg.type) {
    case "handshake": {
      const payload = msg.payload as HandshakePayload;
      if (!payload?.token) {
        sendError(ws, "invalid_payload", "Missing token in handshake", msg.id);
        ws.close();
        return;
      }
      if (!validateToken(payload.token)) {
        sendError(ws, "auth_failed", "Invalid token", msg.id);
        ws.close();
        return;
      }
      state.authenticated = true;
      const config = loadConfig();
      send(ws, {
        id: msg.id,
        type: "handshake.ok",
        payload: {
          version: VERSION,
          roots,
          config: {
            provider: config.provider,
            model: config.model,
            hasApiKey: !!config.apiKey,
            apiKeys: Object.fromEntries(Object.entries(config.apiKeys || {}).map(([k]) => [k, true])),
          },
        },
      });
      break;
    }

    case "fs.read": {
      const payload = msg.payload as FsReadPayload;
      if (!payload?.path) {
        sendError(ws, "invalid_payload", "Missing path", msg.id);
        break;
      }
      const result = readFileSafe(payload.path, roots);
      if ("error" in result) {
        sendError(ws, "fs_error", result.error, msg.id);
      } else {
        send(ws, {
          id: msg.id,
          type: "fs.content",
          payload: { path: payload.path, content: result.content },
        });
      }
      break;
    }

    case "fs.write": {
      const payload = msg.payload as FsWritePayload;
      if (!payload?.path || payload.content === undefined) {
        sendError(ws, "invalid_payload", "Missing path or content", msg.id);
        break;
      }
      const writeResult = writeFileSafe(payload.path, payload.content, roots);
      if (!writeResult.ok) {
        sendError(ws, "fs_error", writeResult.error || "Write failed", msg.id);
      } else {
        send(ws, {
          id: msg.id,
          type: "fs.written",
          payload: { path: payload.path, ok: true },
        });
      }
      break;
    }

    case "fs.list": {
      const payload = msg.payload as FsListPayload | undefined;
      const root = payload?.root || roots[0];
      const files = listFiles(root, roots);
      send(ws, {
        id: msg.id,
        type: "fs.tree",
        payload: { files, projectTree: getProjectTree(roots) },
      });
      break;
    }

    case "llm.chat": {
      const payload = msg.payload as LlmChatPayload;
      const config = loadConfig();

      // Resolve API key: per-provider keys first, then global fallback
      const provider = payload.provider || config.provider || "openai";
      const apiKey = config.apiKeys?.[provider] || config.apiKey || "";
      const providerMeta = MODEL_REGISTRY?.[provider];

      if (!apiKey && !providerMeta?.local) {
        sendError(ws, "config_error", "API key not configured", msg.id);
        return;
      }

      await handleLlmChat(
        {
          provider,
          model: payload.model || config.model || MODEL_REGISTRY[provider]?.models[0]?.id || "gpt-4o",
          apiKey,
          messages: payload.messages,
          context: payload.context,
        },
        (chunk) => {
          send(ws, { id: msg.id, type: "llm.chunk", payload: { delta: chunk } });
        },
        (result) => {
          send(ws, { id: msg.id, type: "llm.done", payload: result });
        },
        (error) => {
          send(ws, { id: msg.id, type: "llm.error", payload: { message: error } });
        }
      );
      break;
    }

    case "config.get": {
      const config = loadConfig();
      send(ws, {
        id: msg.id,
        type: "config.value",
        payload: {
          provider: config.provider,
          model: config.model,
          hasApiKey: !!(config.apiKeys?.[config.provider || ""] || config.apiKey),
          roots: config.roots || roots,
          apiKeys: Object.fromEntries(
            Object.entries(config.apiKeys || {}).map(([k]) => [k, true])
          ),
        },
      });
      break;
    }

    case "config.set": {
      const payload = msg.payload as ConfigSetPayload;
      const updates: Partial<OpenMagicConfig> = {};
      if (payload.provider !== undefined) updates.provider = payload.provider;
      if (payload.model !== undefined) updates.model = payload.model;
      // Per-provider key storage
      if (payload.apiKey !== undefined && payload.provider) {
        const existing = loadConfig();
        const apiKeys = { ...(existing.apiKeys || {}) };
        apiKeys[payload.provider] = payload.apiKey;
        updates.apiKeys = apiKeys;
        updates.apiKey = payload.apiKey; // backward compat
      } else if (payload.apiKey !== undefined) {
        updates.apiKey = payload.apiKey;
      }
      const result = saveConfig(updates);
      if (!result.ok) {
        sendError(ws, "config_error", result.error || "Failed to save", msg.id);
      } else {
        send(ws, { id: msg.id, type: "config.saved", payload: { ok: true } });
      }
      break;
    }

    default:
      sendError(ws, "unknown_type", `Unknown message type: ${msg.type}`, msg.id);
  }
}

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws: WebSocket, code: string, message: string, id?: string): void {
  send(ws, { id: id || "error", type: "error", payload: { code, message } });
}

function serveToolbarBundle(res: http.ServerResponse): void {
  const bundlePaths = [
    join(__dirname, "toolbar", "index.global.js"),
    join(__dirname, "..", "dist", "toolbar", "index.global.js"),
  ];

  for (const bundlePath of bundlePaths) {
    try {
      if (existsSync(bundlePath)) {
        const content = readFileSync(bundlePath, "utf-8");
        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        res.end(content);
        return;
      }
    } catch {
      continue;
    }
  }

  res.writeHead(200, {
    "Content-Type": "application/javascript",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(`(function(){var d=document.createElement("div");d.style.cssText="position:fixed;bottom:20px;right:20px;background:#1a1a2e;color:#e94560;padding:16px 24px;border-radius:12px;font-family:system-ui;font-size:14px;z-index:2147483647;box-shadow:0 4px 24px rgba(0,0,0,0.3);";d.textContent="OpenMagic: Toolbar bundle not found.";document.body.appendChild(d);})();`);
}
