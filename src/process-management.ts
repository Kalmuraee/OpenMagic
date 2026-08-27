
import { isAbsolute, relative, resolve, sep } from "node:path";

export function parsePort(value: string | number, label = "port"): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

export function isSameOrNestedPath(candidate: string, expected: string): boolean {
  const rel = relative(resolve(expected), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function platformCommand(command: string, platform = process.platform): string {
  if (platform === "win32" && ["npm", "npx", "pnpm", "yarn", "bun"].includes(command)) return `${command}.cmd`;
  return command;
}
