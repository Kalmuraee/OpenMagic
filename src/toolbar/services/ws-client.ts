type MessageHandler = (msg: any) => void;

let ws: WebSocket | null = null;
let handlers: Map<string, MessageHandler> = new Map();
let globalHandlers: ((msg: any) => void)[] = [];
let messageQueue: string[] = [];
let connected = false;
let shouldReconnect = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function connect(port: number, token: string): Promise<void> {
  shouldReconnect = true;

  return new Promise((resolve, reject) => {
    let settled = false;

    const handshakeTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Handshake timeout"));
        ws?.close();
      }
    }, 10000);

    try {
      // Same-origin WebSocket — use page hostname and given port
      const wsHost = window.location.hostname || "127.0.0.1";
      ws = new WebSocket(`ws://${wsHost}:${port}/__openmagic__/ws`);

      ws.onopen = () => {
        // Send handshake directly (bypass send() which checks connected flag)
        const handshakeId = generateId();
        ws!.send(JSON.stringify({ id: handshakeId, type: "handshake", payload: { token } }));

        handlers.set(handshakeId, (msg) => {
          if (msg.type === "handshake.ok") {
            clearTimeout(handshakeTimeout);
            connected = true;
            // Flush queued messages
            for (const queued of messageQueue) {
              ws?.send(queued);
            }
            messageQueue = [];
            if (!settled) { settled = true; resolve(); }
          } else if (msg.type === "error") {
            clearTimeout(handshakeTimeout);
            if (!settled) { settled = true; reject(new Error(msg.payload?.message || "Handshake failed")); }
          }
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && handlers.has(msg.id)) {
            const handler = handlers.get(msg.id)!;
            handler(msg);
            if (msg.type === "llm.done" || msg.type === "llm.error" || !msg.type.startsWith("llm.")) {
              handlers.delete(msg.id);
            }
          }
          for (const handler of globalHandlers) {
            handler(msg);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        const wasConnected = connected;
        connected = false;

        if (!wasConnected && !settled) {
          // Connection closed before handshake completed
          clearTimeout(handshakeTimeout);
          settled = true;
          reject(new Error("WebSocket closed before handshake"));
          return;
        }

        // Only reconnect if we were previously connected and should reconnect
        if (wasConnected && shouldReconnect && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect(port, token).then(() => {
              // Notify toolbar of reconnection
              for (const handler of globalHandlers) {
                handler({ type: "reconnected", payload: {} });
              }
            }).catch(() => {});
          }, 2000);
        }
      };

      ws.onerror = () => {
        if (!connected && !settled) {
          clearTimeout(handshakeTimeout);
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };
    } catch (e) {
      clearTimeout(handshakeTimeout);
      if (!settled) { settled = true; reject(e); }
    }
  });
}

export function send(msg: { id: string; type: string; payload?: any }): void {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN && connected) {
    ws.send(data);
  } else {
    messageQueue.push(data);
  }
}

export function request(type: string, payload?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = generateId();
    const timeout = setTimeout(() => {
      handlers.delete(id);
      reject(new Error("Request timeout"));
    }, 30000);

    handlers.set(id, (msg) => {
      clearTimeout(timeout);
      if (msg.type === "error") {
        reject(new Error(msg.payload?.message || "Unknown error"));
      } else {
        resolve(msg);
      }
    });

    send({ id, type, payload });
  });
}

export function stream(
  type: string,
  payload: any,
  onChunk: (chunk: string) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = generateId();
    const timeout = setTimeout(() => {
      handlers.delete(id);
      reject(new Error("Stream timeout"));
    }, 120000);

    handlers.set(id, (msg) => {
      if (msg.type === "llm.chunk") {
        onChunk(msg.payload?.delta || "");
      } else if (msg.type === "llm.done") {
        clearTimeout(timeout);
        handlers.delete(id);
        resolve(msg.payload);
      } else if (msg.type === "llm.error" || msg.type === "error") {
        clearTimeout(timeout);
        handlers.delete(id);
        reject(new Error(msg.payload?.message || "Stream error"));
      }
    });

    send({ id, type, payload });
  });
}

export function onMessage(handler: (msg: any) => void): () => void {
  globalHandlers.push(handler);
  return () => {
    globalHandlers = globalHandlers.filter((h) => h !== handler);
  };
}

export function isConnected(): boolean {
  return connected;
}

export function disconnect(): void {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
}
