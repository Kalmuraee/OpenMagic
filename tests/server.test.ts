import { describe, expect, it } from "vitest";
import { authorizeOperation, getOperationCategory, isAllowedWsOrigin, wrapToolbarBundle } from "../src/server.js";

describe("isAllowedWsOrigin", () => {
  it("allows absent origins for non-browser local clients", () => {
    expect(isAllowedWsOrigin("")).toBe(true);
  });

  it("allows exact localhost origins", () => {
    expect(isAllowedWsOrigin("http://localhost:4567")).toBe(true);
    expect(isAllowedWsOrigin("http://127.0.0.1:4567")).toBe(true);
    expect(isAllowedWsOrigin("http://[::1]:4567")).toBe(true);
  });

  it("rejects localhost-prefixed domains", () => {
    expect(isAllowedWsOrigin("http://localhost.evil.example")).toBe(false);
    expect(isAllowedWsOrigin("http://127.0.0.1.evil.example")).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(isAllowedWsOrigin("not a url")).toBe(false);
  });
});

describe("operation authorization", () => {
  it("classifies known WebSocket message types", () => {
    const knownTypes = [
      "handshake",
      "fs.read",
      "fs.list",
      "fs.grep",
      "fs.write",
      "fs.undo",
      "fs.patch.preview",
      "fs.patch.apply",
      "fs.patch.rollback",
      "fs.delete",
      "config.get",
      "config.set",
      "llm.chat",
      "provider.models",
      "provider.testModel",
      "project.ground",
      "debug.logs",
    ];

    for (const type of knownTypes) {
      expect(getOperationCategory(type)).not.toBeNull();
    }
  });

  it("rejects unknown and unauthenticated operations", () => {
    expect(authorizeOperation("handshake", false)).toBe(true);
    expect(authorizeOperation("config.get", false)).toBe(false);
    expect(authorizeOperation("config.get", true)).toBe(true);
    expect(authorizeOperation("unknown.type", true)).toBe(false);
  });
});

describe("toolbar bundle wrapping", () => {
  it("keeps the token private to the wrapper argument", () => {
    const wrapped = wrapToolbarBundle("console.log(typeof __OPENMAGIC_TOKEN__);", "secret-token");

    expect(wrapped).toContain("(function(__OPENMAGIC_TOKEN__)");
    expect(wrapped).toContain(JSON.stringify("secret-token"));
    expect(wrapped).not.toContain("const __OPENMAGIC_TOKEN__");
    expect(wrapped).not.toContain("window.__OPENMAGIC_TOKEN__");
  });
});
