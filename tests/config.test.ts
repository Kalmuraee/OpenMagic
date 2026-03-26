import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// We need to test saveConfig/loadConfig but they use ~/.openmagic
// So we'll test the return value of saveConfig
import { saveConfig, loadConfig } from "../src/config.js";

describe("saveConfig", () => {
  it("returns ok on successful save", () => {
    const result = saveConfig({ provider: "test-provider" });
    expect(result.ok).toBe(true);
  });

  it("persists and loads config", () => {
    saveConfig({ provider: "openai", model: "gpt-5.4" });
    const config = loadConfig();
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-5.4");
  });
});
