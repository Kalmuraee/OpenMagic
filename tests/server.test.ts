import { describe, expect, it } from "vitest";
import { isAllowedWsOrigin } from "../src/server.js";

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
