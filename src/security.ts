import { randomBytes } from "node:crypto";

let sessionToken: string | null = null;

export function generateSessionToken(): string {
  sessionToken = randomBytes(32).toString("hex");
  return sessionToken;
}

export function getSessionToken(): string {
  if (!sessionToken) {
    return generateSessionToken();
  }
  return sessionToken;
}

export function validateToken(token: string): boolean {
  return token === sessionToken;
}
