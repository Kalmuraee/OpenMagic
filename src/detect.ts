import { createConnection } from "node:net";

const COMMON_DEV_PORTS = [
  3000, // React (CRA), Next.js, Express
  5173, // Vite
  5174, // Vite (alternate)
  4200, // Angular
  8080, // Vue CLI, generic
  8000, // Django, Python
  8888, // Jupyter, generic
  3001, // Common alternate
  4000, // Phoenix, generic
  1234, // Parcel
];

function checkPort(port: number, host: string = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 500 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export interface DetectedServer {
  port: number;
  host: string;
}

export async function detectDevServer(): Promise<DetectedServer | null> {
  const checks = COMMON_DEV_PORTS.map(async (port) => {
    const isOpen = await checkPort(port);
    return isOpen ? port : null;
  });

  const results = await Promise.all(checks);
  const foundPort = results.find((p) => p !== null);

  if (foundPort) {
    return { port: foundPort, host: "127.0.0.1" };
  }

  return null;
}

export async function isPortOpen(port: number): Promise<boolean> {
  return checkPort(port);
}

export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  while (await isPortOpen(port)) {
    port++;
    if (port > startPort + 100) {
      throw new Error(`Could not find an available port near ${startPort}`);
    }
  }
  return port;
}
