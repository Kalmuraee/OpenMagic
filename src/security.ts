import { randomBytes, timingSafeEqual } from "node:crypto";

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
  if (!sessionToken || typeof token !== "string") return false;
  // Constant-time comparison to avoid leaking the token via response timing.
  const a = Buffer.from(token);
  const b = Buffer.from(sessionToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
