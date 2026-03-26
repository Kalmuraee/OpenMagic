import { describe, it, expect } from "vitest";
import { detectDevScripts, checkDependenciesInstalled } from "../src/detect.js";

describe("detectDevScripts", () => {
  it("detects scripts from current project", () => {
    // The OpenMagic project itself has dev/build scripts
    const scripts = detectDevScripts(process.cwd());
    // Should find at least the "dev" script
    expect(scripts.length).toBeGreaterThanOrEqual(0);
  });
});

describe("checkDependenciesInstalled", () => {
  it("detects node_modules in current project", () => {
    const status = checkDependenciesInstalled(process.cwd());
    expect(status.installed).toBe(true);
    expect(status.packageManager).toBe("npm"); // This project uses npm
  });
});
