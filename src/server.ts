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

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ClientState {
  authenticated: boolean;
}

export function createOpenMagicServer(
  proxyPort: number,
  roots: string[]
): { httpServer: http.Server; wss: WebSocketServer } {
  const httpServer = http.createServer((req, res) => {
    // Serve toolbar bundle
    if (req.url === "/__openmagic__/toolbar.js") {
      serveToolbarBundle(res);
      return;
    }

    // Health check
    if (req.url === "/__openmagic__/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ status: "ok", version: "0.10.0" }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/__openmagic__/ws",
  });

  const clientStates = new WeakMap<WebSocket, ClientState>();

  wss.on("connection", (ws, req) => {
    // Validate Origin — only allow localhost connections
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

      // Require handshake first
      if (!state.authenticated && msg.type !== "handshake") {
        sendError(ws, "auth_required", "Handshake required");
        return;
      }

      try {
        await handleMessage(ws, msg, state, roots, proxyPort);
      } catch (e: unknown) {
        sendError(ws, "internal_error", (e as Error).message, msg.id);
      }
    });

    ws.on("close", () => {
      clientStates.delete(ws);
    });
  });

  return { httpServer, wss };
}

async function handleMessage(
  ws: WebSocket,
  msg: WsMessage,
  state: ClientState,
  roots: string[],
  _proxyPort: number
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
          version: "0.10.0",
          roots,
          config: {
            provider: config.provider,
            model: config.model,
            hasApiKey: !!config.apiKey,
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
      const result = writeFileSafe(payload.path, payload.content, roots);
      send(ws, {
        id: msg.id,
        type: "fs.written",
        payload: { path: payload.path, ok: result.ok, error: result.error },
      });
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

      const providerMeta = MODEL_REGISTRY?.[payload.provider || config.provider || ""];
      if (!config.apiKey && !providerMeta?.local) {
        sendError(ws, "config_error", "API key not configured", msg.id);
        return;
      }

      await handleLlmChat(
        {
          provider: payload.provider || config.provider || "openai",
          model: payload.model || config.model || "gpt-4o",
          apiKey: config.apiKey,
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
          hasApiKey: !!config.apiKey,
          roots: config.roots || roots,
        },
      });
      break;
    }

    case "config.set": {
      const payload = msg.payload as ConfigSetPayload;
      const updates: Partial<OpenMagicConfig> = {};
      if (payload.provider !== undefined) updates.provider = payload.provider;
      if (payload.model !== undefined) updates.model = payload.model;
      if (payload.apiKey !== undefined) updates.apiKey = payload.apiKey;
      // roots are set by CLI only, not browser-configurable
      saveConfig(updates);
      send(ws, {
        id: msg.id,
        type: "config.saved",
        payload: { ok: true },
      });
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

function sendError(
  ws: WebSocket,
  code: string,
  message: string,
  id?: string
): void {
  send(ws, {
    id: id || "error",
    type: "error",
    payload: { code, message },
  });
}

function serveToolbarBundle(res: http.ServerResponse): void {
  // Try to serve the pre-built toolbar bundle
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
      // Permission error or read failure — try next path
      continue;
    }
  }

  // Fallback: serve a minimal placeholder that shows a "build required" message
  res.writeHead(200, {
    "Content-Type": "application/javascript",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(`
    (function() {
      var div = document.createElement("div");
      div.style.cssText = "position:fixed;bottom:20px;right:20px;background:#1a1a2e;color:#e94560;padding:16px 24px;border-radius:12px;font-family:system-ui;font-size:14px;z-index:2147483647;box-shadow:0 4px 24px rgba(0,0,0,0.3);";
      div.textContent = "OpenMagic: Toolbar bundle not found. Run 'npm run build:toolbar' first.";
      document.body.appendChild(div);
    })();
  `);
}
