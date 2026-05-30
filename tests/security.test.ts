import { describe, it, expect } from "vitest";
import { generateSessionToken, getSessionToken, validateToken } from "../src/security.js";

describe("security", () => {
  it("generates a 64-char hex token", () => {
    const token = generateSessionToken();
    expect(token).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(token)).toBe(true);
  });

  it("validates correct token", () => {
    const token = generateSessionToken();
    expect(validateToken(token)).toBe(true);
  });

  it("rejects wrong token", () => {
    generateSessionToken();
    expect(validateToken("wrong-token")).toBe(false);
  });

  it("rejects a token of the wrong length without throwing (constant-time path)", () => {
    const token = generateSessionToken();
    expect(validateToken(token.slice(0, 32))).toBe(false);
    expect(validateToken(token + "extra")).toBe(false);
    expect(validateToken("")).toBe(false);
  });

  it("getSessionToken returns current token", () => {
    const token = generateSessionToken();
    expect(getSessionToken()).toBe(token);
  });
});
