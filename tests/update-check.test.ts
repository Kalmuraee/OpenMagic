import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  detectInstallKind,
  suggestedUpdateCommand,
  formatUpdateNotice,
  checkForCliUpdate,
} from "../src/update-check.js";

afterEach(() => vi.unstubAllGlobals());

describe("compareVersions", () => {
  it("orders releases numerically (not lexically)", () => {
    expect(compareVersions("0.43.2", "0.43.10")).toBe(-1); // 2 < 10 numerically
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.44.0", "0.43.99")).toBe(1);
  });
  it("ignores prerelease/build suffixes", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4-rc", "1.2.3")).toBe(1);
  });
});

describe("isNewerVersion", () => {
  it("is true only when latest > current", () => {
    expect(isNewerVersion("0.44.0", "0.43.2")).toBe(true);
    expect(isNewerVersion("0.43.2", "0.43.2")).toBe(false);
    expect(isNewerVersion("0.43.1", "0.43.2")).toBe(false);
  });
});

describe("detectInstallKind", () => {
  it("detects npx from the npm _npx cache path", () => {
    expect(detectInstallKind("/Users/x/.npm/_npx/abc123/node_modules/openmagic/dist/cli.js")).toBe("npx");
  });
  it("treats a global node_modules path (or anything else) as installed", () => {
    expect(detectInstallKind("/usr/local/lib/node_modules/openmagic/dist/cli.js")).toBe("global");
    expect(detectInstallKind("/opt/homebrew/lib/node_modules/openmagic/dist/cli.js")).toBe("global");
    expect(detectInstallKind("./dist/cli.js")).toBe("global");
  });
});

describe("suggestedUpdateCommand", () => {
  it("matches how it was launched", () => {
    expect(suggestedUpdateCommand("npx")).toBe("npx openmagic@latest");
    expect(suggestedUpdateCommand("global")).toBe("npm install -g openmagic@latest");
  });
});

describe("formatUpdateNotice", () => {
  it("shows both versions and the suggested command", () => {
    const notice = formatUpdateNotice("0.43.2", "0.44.0", "npm install -g openmagic@latest");
    expect(notice).toContain("0.43.2");
    expect(notice).toContain("0.44.0");
    expect(notice).toContain("npm install -g openmagic@latest");
  });
});

describe("checkForCliUpdate (end-to-end, stubbed registry)", () => {
  const stubFetch = (impl) => vi.stubGlobal("fetch", impl);

  it("returns a tailored notice when the registry has a newer version (global)", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) }));
    const notice = await checkForCliUpdate("0.43.2", "/usr/local/lib/node_modules/openmagic/dist/cli.js");
    expect(notice).toContain("9.9.9");
    expect(notice).toContain("npm install -g openmagic@latest");
  });

  it("suggests npx when launched via npx", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) }));
    const notice = await checkForCliUpdate("0.43.2", "/home/u/.npm/_npx/abc/node_modules/openmagic/dist/cli.js");
    expect(notice).toContain("npx openmagic@latest");
  });

  it("returns null when already up to date", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: "0.43.2" }) }));
    expect(await checkForCliUpdate("0.43.2", "x")).toBeNull();
  });

  it("is fail-silent on a network/registry error", async () => {
    stubFetch(async () => { throw new Error("offline"); });
    expect(await checkForCliUpdate("0.43.2", "x")).toBeNull();
  });
});
