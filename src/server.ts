import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { getSessionToken, validateToken } from "./security.js";
import { getProviderApiKey, hasProviderApiKey, loadConfig, saveConfig } from "./config.js";
import { detectAvailableClis, invalidateCliCache } from "./llm/cli-detect.js";
import { readFileSafe, writeFileSafe, deleteFileSafe, listFiles, getProjectTree, grepFiles, undoFileSafe, cleanupBackups } from "./filesystem.js";
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
import { coerceThinkingLevel } from "./llm/thinking.js";
import { AbortRegistry } from "./abort-registry.js";
import { verifyPatchGroup } from "./verify.js";
import { extractAgentDirectives, runAgentLoop, type AgentContext } from "./llm/agent-loop.js";
import { MODEL_REGISTRY } from "./llm/registry.js";
import { fetchProviderModels, getToolbarRegistry } from "./llm/models.js";
import { pruneOldManifests, type PatchGroupRequest } from "./patch.js";
import { applyPatchGroupAcrossRoots, previewPatchGroupAcrossRoots, rollbackPatchGroupAcrossRoots } from "./multi-root-patch.js";
import { displayPathFor, resolveProjectPath } from "./root-resolver.js";
import { groundProjects, type ProjectGroundRequest } from "./project-grounding.js";
import { testProviderModel } from "./llm/provider-test.js";

import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const VERSION: string = _require("../package.json").version;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Server-side log buffer ──
const MAX_SERVER_LOGS = 200;
const serverLogs: { level: string; msg: string; ts: number }[] = [];

function captureServerLog(level: string, ...args: any[]) {
  const msg = args.map(a => {
    try { return typeof a === "object" ? JSON.stringify(a).slice(0, 500) : String(a); }
    catch { return String(a); }
  }).join(" ");
  serverLogs.push({ level, msg, ts: Date.now() });
  if (serverLogs.length > MAX_SERVER_LOGS) serverLogs.shift();
}

// Intercept console to buffer server logs
const _origLog = console.log, _origWarn = console.warn, _origErr = console.error, _origInfo = console.info;
console.log = (...a: any[]) => { captureServerLog("log", ...a); _origLog(...a); };
console.warn = (...a: any[]) => { captureServerLog("warn", ...a); _origWarn(...a); };
console.error = (...a: any[]) => { captureServerLog("error", ...a); _origErr(...a); };
console.info = (...a: any[]) => { captureServerLog("info", ...a); _origInfo(...a); };

interface ClientState {
  authenticated: boolean;
  connId: string;
}

// Tracks in-flight LLM requests so they can be cancelled on llm.cancel / disconnect.
const llmAbortRegistry = new AbortRegistry();
let connCounter = 0;

export type OperationCategory = "auth" | "read" | "write" | "delete" | "config" | "llm" | "debug" | "models";

const OPERATION_CATEGORIES: Record<string, OperationCategory> = {
  handshake: "auth",
  "fs.read": "read",
  "fs.list": "read",
  "fs.grep": "read",
  "fs.write": "write",
  "fs.undo": "write",
  "fs.patch.preview": "write",
  "fs.patch.apply": "write",
  "fs.patch.rollback": "write",
  "fs.patch.verify": "write",
  "fs.delete": "delete",
  "config.get": "config",
  "config.set": "config",
  "llm.chat": "llm",
  "llm.cancel": "llm",
  "agent.run": "llm",
  "provider.models": "models",
  "provider.testModel": "models",
  "project.ground": "read",
  "debug.logs": "debug",
};

export function getOperationCategory(type: string): OperationCategory | null {
  return OPERATION_CATEGORIES[type] || null;
}

export function authorizeOperation(type: string, authenticated: boolean): boolean {
  if (type === "handshake") return true;
  return authenticated && !!getOperationCategory(type);
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

  // Drop undo manifests left over from sessions more than 7 days ago, while
  // keeping recent ones so a crashed session's edits can still be rolled back.
  pruneOldManifests(7 * 24 * 60 * 60 * 1000);

  // Request handler for /__openmagic__/ paths — returns true if handled
  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!req.url?.startsWith("/__openmagic__/")) return false;

    // Strip query string for path matching (e.g., toolbar.js?v=123)
    const urlPath = req.url.split("?")[0];

    if (urlPath === "/__openmagic__/toolbar.js") {
      serveToolbarBundle(res, getSessionToken());
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
    if (!isAllowedWsOrigin(origin)) {
      ws.close(4003, "Forbidden origin");
      return;
    }
    const connId = String(++connCounter);
    clientStates.set(ws, { authenticated: false, connId });

    ws.on("message", async (data) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendError(ws, "parse_error", "Invalid JSON");
        return;
      }

      const state = clientStates.get(ws)!;

      if (!authorizeOperation(msg.type, state.authenticated)) {
        const category = getOperationCategory(msg.type);
        if (!state.authenticated && category) {
          sendError(ws, "auth_required", "Handshake required", msg.id);
        } else {
          sendError(ws, "unknown_type", `Unknown message type: ${msg.type}`, msg.id);
        }
        return;
      }

      try {
        await handleMessage(ws, msg, state, roots);
      } catch (e: unknown) {
        sendError(ws, "internal_error", (e as Error).message, msg.id);
      }
    });

    ws.on("close", () => {
      // Cancel any in-flight LLM work for this connection so server-side
      // fetch()/CLI children don't keep running (and editing files) after the
      // toolbar tab is gone.
      llmAbortRegistry.abortByPrefix(`${connId}:`);
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
            hasApiKey: hasProviderApiKey(config, config.provider || ""),
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
      const resolved = resolveProjectPath(payload.path, roots, { mustExist: true });
      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
      const result = readFileSafe(resolved.absolutePath, [resolved.root]);
      if ("error" in result) {
        sendError(ws, "fs_error", result.error, msg.id);
      } else {
        send(ws, {
          id: msg.id,
          type: "fs.content",
          payload: { path: resolved.displayPath, content: result.content },
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
      const resolved = resolveProjectPath(payload.path, roots, { forCreate: true });
      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
      const writeResult = writeFileSafe(resolved.absolutePath, payload.content, [resolved.root]);
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

    case "fs.delete": {
      const payload = msg.payload as { path: string };
      if (!payload?.path) {
        sendError(ws, "invalid_payload", "Missing path", msg.id);
        break;
      }
      const resolved = resolveProjectPath(payload.path, roots, { mustExist: false });
      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
      const deleteResult = deleteFileSafe(resolved.absolutePath, [resolved.root]);
      if (!deleteResult.ok) {
        sendError(ws, "fs_error", deleteResult.error || "Delete failed", msg.id);
      } else {
        send(ws, {
          id: msg.id,
          type: "fs.deleted",
          payload: { path: payload.path, ok: true },
        });
      }
      break;
    }

    case "fs.undo": {
      const payload = msg.payload as { path: string };
      if (!payload?.path) { sendError(ws, "invalid_payload", "Missing path", msg.id); break; }
      const resolved = resolveProjectPath(payload.path, roots, { mustExist: false });
      if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
      const undoResult = undoFileSafe(resolved.absolutePath, [resolved.root]);
      if (!undoResult.ok) { sendError(ws, "fs_error", undoResult.error || "Undo failed", msg.id); break; }
      send(ws, { id: msg.id, type: "fs.undone", payload: { path: payload.path, ok: true, undoCount: undoResult.remainingUndoCount || 0 } });
      break;
    }

    case "fs.patch.preview": {
      const payload = msg.payload as PatchGroupRequest | undefined;
      if (!payload?.patches?.length) {
        sendError(ws, "invalid_payload", "Missing patches", msg.id);
        break;
      }
      const result = previewPatchGroupAcrossRoots(roots, payload);
      send(ws, { id: msg.id, type: "fs.patch.previewed", payload: result });
      break;
    }

    case "fs.patch.apply": {
      const payload = msg.payload as PatchGroupRequest | undefined;
      if (!payload?.patches?.length) {
        sendError(ws, "invalid_payload", "Missing patches", msg.id);
        break;
      }
      const result = applyPatchGroupAcrossRoots(roots, payload);
      send(ws, { id: msg.id, type: "fs.patch.applied", payload: result });
      break;
    }

    case "fs.patch.rollback": {
      const payload = msg.payload as { groupId?: string; chain?: boolean } | undefined;
      if (!payload?.groupId) {
        sendError(ws, "invalid_payload", "Missing groupId", msg.id);
        break;
      }
      const result = rollbackPatchGroupAcrossRoots(roots, payload.groupId, payload.chain === true);
      if (!result.ok) {
        sendError(ws, "fs_error", result.error || "Rollback failed", msg.id);
      } else {
        send(ws, { id: msg.id, type: "fs.patch.rolledback", payload: result });
      }
      break;
    }

    case "fs.patch.verify": {
      const payload = msg.payload as { files?: string[]; timeoutMs?: number } | undefined;
      const files = Array.isArray(payload?.files) ? payload!.files : [];
      // Cancellable like llm.chat: a closed tab / explicit cancel kills the spawned
      // typecheck so it doesn't keep running.
      const reqId = `${state.connId}:${msg.id}`;
      const controller = llmAbortRegistry.register(reqId);
      try {
        const result = await verifyPatchGroup(roots, {
          files,
          timeoutMs: payload?.timeoutMs,
          signal: controller.signal,
        });
        send(ws, { id: msg.id, type: "fs.patch.verified", payload: result });
      } finally {
        llmAbortRegistry.complete(reqId);
      }
      break;
    }

    case "fs.list": {
      const payload = msg.payload as FsListPayload | undefined;
      if (payload?.root) {
        const resolved = resolveProjectPath(payload.root, roots, { mustExist: true });
        if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
        const files = listFiles(resolved.absolutePath, [resolved.root]);
        send(ws, { id: msg.id, type: "fs.tree", payload: { files, projectTree: getProjectTree(roots) } });
        break;
      }
      const files = roots.flatMap((root) => listFiles(root, [root]).map((file) => ({
        ...file,
        path: displayPathFor(root, file.path, roots),
      })));
      send(ws, { id: msg.id, type: "fs.tree", payload: { files, projectTree: getProjectTree(roots) } });
      break;
    }

    case "llm.chat": {
      const payload = msg.payload as LlmChatPayload;
      const config = loadConfig();

      // Resolve API key: per-provider keys first, then global fallback
      const provider = payload.provider || config.provider || "openai";
      const apiKey = getProviderApiKey(config, provider);
      const providerMeta = MODEL_REGISTRY?.[provider];

      if (!apiKey && !providerMeta?.local) {
        sendError(ws, "config_error", "API key not configured", msg.id);
        return;
      }

      // Apply the user's saved per-provider thinking preference (was previously
      // stored but never used) unless the request already specified one.
      const llmContext = payload.context || {};
      if (llmContext.reasoningLevel === undefined) {
        const pref = coerceThinkingLevel(config.preferredThinkingMode?.[provider]);
        if (pref) llmContext.reasoningLevel = pref;
      }

      const reqId = `${state.connId}:${msg.id}`;
      const controller = llmAbortRegistry.register(reqId);
      await handleLlmChat(
        {
          provider,
          model: payload.model || config.model || MODEL_REGISTRY[provider]?.models[0]?.id || "gpt-4o",
          apiKey,
          messages: payload.messages,
          context: llmContext,
          // H11: opt-in native tool-calling (config flag or env), off by default.
          useTools: config.useTools === true || process.env.OPENMAGIC_TOOLS === "1",
          // H9: opt-in CLI native-edit (config flag or env), off by default.
          nativeEdit: config.nativeEdit === true || process.env.OPENMAGIC_NATIVE_EDIT === "1",
          root: roots[0],
          roots,
        },
        (chunk) => {
          send(ws, { id: msg.id, type: "llm.chunk", payload: { delta: chunk } });
        },
        (result) => {
          llmAbortRegistry.complete(reqId);
          send(ws, { id: msg.id, type: "llm.done", payload: result });
        },
        (error) => {
          llmAbortRegistry.complete(reqId);
          send(ws, { id: msg.id, type: "llm.error", payload: { message: error } });
        },
        controller.signal
      );
      llmAbortRegistry.complete(reqId);
      break;
    }

    case "llm.cancel": {
      // Abort the in-flight request with the given id. The waiting client-side
      // stream is resolved locally by ws-client, so no response is required.
      const payload = msg.payload as { id?: string } | undefined;
      if (payload?.id) llmAbortRegistry.abort(`${state.connId}:${payload.id}`);
      send(ws, { id: msg.id, type: "llm.done", payload: { content: "", modifications: [], cancelled: true } });
      break;
    }

    case "agent.run": {
      // H12: server-side investigate→edit loop. Same envelope as llm.chat
      // (llm.chunk/llm.done/llm.error) so the toolbar consumes it identically;
      // the difference is OpenMagic reads files / searches server-side across
      // bounded steps instead of round-tripping each NEED_FILE through the browser.
      const payload = msg.payload as LlmChatPayload;
      const config = loadConfig();
      const provider = payload.provider || config.provider || "openai";
      const apiKey = getProviderApiKey(config, provider);
      const providerMeta = MODEL_REGISTRY?.[provider];
      if (!apiKey && !providerMeta?.local) {
        sendError(ws, "config_error", "API key not configured", msg.id);
        return;
      }
      const model = payload.model || config.model || MODEL_REGISTRY[provider]?.models[0]?.id || "gpt-4o";
      const baseContext = payload.context || {};
      if (baseContext.reasoningLevel === undefined) {
        const pref = coerceThinkingLevel(config.preferredThinkingMode?.[provider]);
        if (pref) baseContext.reasoningLevel = pref;
      }
      const root = roots[0] || process.cwd();
      const reqId = `${state.connId}:${msg.id}`;
      const controller = llmAbortRegistry.register(reqId);

      // One model turn: send the prompt + accumulated context, parse the reply
      // into edits + investigate directives.
      const step = (loopCtx: AgentContext) => new Promise<{ text: string; modifications: any[]; needFiles: string[]; searchQueries: string[] }>((resolve) => {
        const mergedFiles = [
          ...((baseContext.files as any[]) || []),
          ...loopCtx.files,
        ];
        const seen = new Set<string>();
        const files = mergedFiles.filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
        const ctx = { ...baseContext, files, searchResults: loopCtx.searchResults.map((s) => ({ query: s.query, matches: [{ file: "search", lineNum: 0, line: s.result }] })) } as any;
        handleLlmChat(
          { provider, model, apiKey, messages: payload.messages, context: ctx, roots, useTools: config.useTools === true || process.env.OPENMAGIC_TOOLS === "1", root },
          (chunk) => send(ws, { id: msg.id, type: "llm.chunk", payload: { delta: chunk } }),
          (result) => {
            const directives = extractAgentDirectives(result.content || "");
            resolve({ text: result.content || "", modifications: (result.modifications as any[]) || [], ...directives });
          },
          () => resolve({ text: "", modifications: [], needFiles: [], searchQueries: [] }),
          controller.signal
        );
      });

      try {
        const result = await runAgentLoop(
          {
            step,
            readFile: async (p) => {
              const resolved = resolveProjectPath(p, roots, { mustExist: true });
              if ("error" in resolved) return null;
              const r = readFileSafe(resolved.absolutePath, [resolved.root]);
              return "error" in r ? null : r.content.slice(0, 16000);
            },
            search: async (q) => roots.flatMap((candidate) =>
              grepFiles(q, candidate, [candidate]).map((m) => `${displayPathFor(candidate, m.file, roots)}:${m.lineNum}: ${m.line}`)
            ).join("\n"),
            onEvent: (e) => { if (e.type === "investigate") send(ws, { id: msg.id, type: "llm.chunk", payload: { delta: "" } }); },
          },
          { maxSteps: 6, signal: controller.signal }
        );
        send(ws, { id: msg.id, type: "llm.done", payload: { content: result.content, modifications: result.modifications, parseStatus: "clean" } });
      } catch (e) {
        send(ws, { id: msg.id, type: "llm.error", payload: { message: (e as Error).message } });
      } finally {
        llmAbortRegistry.complete(reqId);
      }
      break;
    }

    case "config.get": {
      const config = loadConfig();

      // Auto-detect available CLI agents
      const detectedClis = await detectAvailableClis();
      const cliStatuses = detectedClis.map((c) => ({
        id: c.id,
        name: c.name,
        installed: c.installed,
        authenticated: c.authenticated,
        version: c.version,
      }));

      // Auto-select: if no provider is saved, pick the best available CLI
      let provider = config.provider || "";
      let model = config.model || "";
      if (!provider) {
        const bestCli = detectedClis.find((c) => c.installed && c.authenticated);
        if (bestCli) {
          provider = bestCli.id;
          model = bestCli.id; // CLI providers use same ID for model
        }
      }

      send(ws, {
        id: msg.id,
        type: "config.value",
        payload: {
          provider,
          model,
          planBeforeEdit: !!config.planBeforeEdit,
          serverAgent: config.serverAgent === true || process.env.OPENMAGIC_SERVER_AGENT === "1",
          hasApiKey: hasProviderApiKey(config, provider),
          roots: config.roots || roots,
          apiKeys: Object.fromEntries(
            Object.entries(config.apiKeys || {}).map(([k]) => [k, true])
          ),
          providers: getToolbarRegistry(),
          detectedClis: cliStatuses,
        },
      });
      break;
    }

    case "provider.models": {
      const payload = msg.payload as { provider?: string; refresh?: boolean } | undefined;
      const provider = payload?.provider;
      if (!provider) {
        sendError(ws, "invalid_payload", "Missing provider", msg.id);
        break;
      }

      const config = loadConfig();
      const apiKey = getProviderApiKey(config, provider);
      const result = await fetchProviderModels(provider, apiKey, { refresh: payload?.refresh });
      send(ws, {
        id: msg.id,
        type: "provider.models.result",
        payload: result,
      });
      break;
    }

    case "provider.testModel": {
      const payload = msg.payload as { provider?: string; model?: string } | undefined;
      const provider = payload?.provider;
      const model = payload?.model;
      if (!provider || !model) {
        sendError(ws, "invalid_payload", "Missing provider or model", msg.id);
        break;
      }

      const config = loadConfig();
      const apiKey = getProviderApiKey(config, provider);
      const result = await testProviderModel(provider, model, apiKey);
      send(ws, {
        id: msg.id,
        type: "provider.testModel.result",
        payload: result,
      });
      break;
    }

    case "project.ground": {
      const payload = msg.payload as ProjectGroundRequest | undefined;
      const result = groundProjects(roots, payload || {});
      send(ws, {
        id: msg.id,
        type: "project.ground.result",
        payload: result,
      });
      break;
    }

    case "config.set": {
      const payload = msg.payload as ConfigSetPayload;
      const updates: Partial<OpenMagicConfig> = {};
      if (payload.provider !== undefined) updates.provider = payload.provider;
      if (payload.model !== undefined) updates.model = payload.model;
      if (payload.planBeforeEdit !== undefined) updates.planBeforeEdit = payload.planBeforeEdit;
      // Per-provider key storage
      if (payload.apiKey !== undefined && payload.provider) {
        const existing = loadConfig();
        const apiKeys = { ...(existing.apiKeys || {}) };
        apiKeys[payload.provider] = payload.apiKey;
        updates.apiKeys = apiKeys;
      } else if (payload.apiKey !== undefined) {
      }
      const result = saveConfig(updates);
      if (!result.ok) {
        sendError(ws, "config_error", result.error || "Failed to save", msg.id);
      } else {
        send(ws, { id: msg.id, type: "config.saved", payload: { ok: true } });
      }
      break;
    }

    case "fs.grep": {
      const payload = msg.payload as { pattern: string; path?: string };
      if (!payload?.pattern) {
        sendError(ws, "invalid_payload", "Missing pattern", msg.id);
        break;
      }
      let results: Array<{ file: string; lineNum: number; line: string }> = [];
      if (payload.path) {
        const resolved = resolveProjectPath(payload.path, roots, { mustExist: true });
        if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
        results = grepFiles(payload.pattern, resolved.absolutePath, [resolved.root])
          .map((match) => ({ ...match, file: displayPathFor(resolved.root, match.file, roots) }));
      } else {
        results = roots.flatMap((root) => grepFiles(payload.pattern, root, [root])
          .map((match) => ({ ...match, file: displayPathFor(root, match.file, roots) })));
      }
      send(ws, { id: msg.id, type: "fs.grep.result", payload: { results } });
      break;
    }

    case "debug.logs": {
      send(ws, {
        id: msg.id,
        type: "debug.logs",
        payload: {
          logs: serverLogs.slice(-100),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          uptime: Math.round(process.uptime()),
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          pid: process.pid,
          cwd: process.cwd(),
        },
      });
      break;
    }

    default:
      sendError(ws, "unknown_type", `Unknown message type: ${msg.type}`, msg.id);
  }
}

export function isAllowedWsOrigin(origin: string): boolean {
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]";
  } catch {
    return false;
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

function serveToolbarBundle(res: http.ServerResponse, token: string): void {
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
        res.end(wrapToolbarBundle(content, token));
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
  res.end(wrapToolbarBundle(`(function(){var d=document.createElement("div");d.style.cssText="position:fixed;bottom:20px;right:20px;background:#1a1a2e;color:#e94560;padding:16px 24px;border-radius:12px;font-family:system-ui;font-size:14px;z-index:2147483647;box-shadow:0 4px 24px rgba(0,0,0,0.3);";d.textContent="OpenMagic: Toolbar bundle not found.";document.body.appendChild(d);})();`, token));
}

export function wrapToolbarBundle(content: string, token: string): string {
  return `(function(__OPENMAGIC_TOKEN__){\n${content}\n})(${JSON.stringify(token)});`;
}
