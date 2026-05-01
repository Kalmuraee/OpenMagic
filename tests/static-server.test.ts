import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { getStaticMimeType, resolveStaticRequestPath } from "../src/static-server.js";

const ROOT = resolve(process.cwd(), ".test-static-root");

describe("resolveStaticRequestPath", () => {
  it("resolves root to index.html", () => {
    expect(resolveStaticRequestPath(ROOT, "/")).toBe(join(ROOT, "index.html"));
  });

  it("ignores query strings", () => {
    expect(resolveStaticRequestPath(ROOT, "/index.html?cache=1")).toBe(join(ROOT, "index.html"));
  });

  it("resolves nested assets inside root", () => {
    expect(resolveStaticRequestPath(ROOT, "/assets/app.js")).toBe(join(ROOT, "assets", "app.js"));
  });

  it("rejects traversal paths", () => {
    expect(resolveStaticRequestPath(ROOT, "/../secret.txt")).toBeNull();
  });

  it("rejects encoded traversal paths", () => {
    expect(resolveStaticRequestPath(ROOT, "/%2e%2e/secret.txt")).toBeNull();
  });

  it("rejects malformed escapes", () => {
    expect(resolveStaticRequestPath(ROOT, "/%zz")).toBeNull();
  });
});

describe("getStaticMimeType", () => {
  it("returns known static MIME types", () => {
    expect(getStaticMimeType("app.js")).toBe("application/javascript");
  });

  it("falls back to binary for unknown extensions", () => {
    expect(getStaticMimeType("file.unknown")).toBe("application/octet-stream");
  });
});
