type MessageHandler = (msg: any) => void;

let ws: WebSocket | null = null;
let handlers: Map<string, MessageHandler> = new Map();
let globalHandlers: ((msg: any) => void)[] = [];
let messageQueue: string[] = [];
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function connect(port: number, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/__openmagic__/ws`);

      ws.onopen = () => {
        // Send handshake
        const handshakeId = generateId();
        send({ id: handshakeId, type: "handshake", payload: { token } });

        // Wait for handshake.ok
        handlers.set(handshakeId, (msg) => {
          if (msg.type === "handshake.ok") {
            connected = true;
            // Flush queued messages
            for (const queued of messageQueue) {
              ws?.send(queued);
            }
            messageQueue = [];
            resolve();
          } else if (msg.type === "error") {
            reject(new Error(msg.payload?.message || "Handshake failed"));
          }
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Route to specific handler if exists
          if (msg.id && handlers.has(msg.id)) {
            const handler = handlers.get(msg.id)!;
            handler(msg);
            // Don't delete handler for streaming responses
            if (msg.type === "llm.done" || msg.type === "llm.error" || !msg.type.startsWith("llm.")) {
              handlers.delete(msg.id);
            }
          }

          // Notify global handlers
          for (const handler of globalHandlers) {
            handler(msg);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        connected = false;
        // Reconnect after 2 seconds
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect(port, token).catch(() => {});
          }, 2000);
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };
    } catch (e) {
      reject(e);
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
    }, 120000); // 2 min timeout for LLM responses

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
