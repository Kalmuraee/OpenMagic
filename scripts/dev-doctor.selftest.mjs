import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  diagnoseProject,
  isVersionAtLeast,
  minimumVersionFromRange,
  parseDoctorArgs,
  summarizeChecks,
} from "./dev-doctor.mjs";

test("compares semver-like Node versions", () => {
  assert.equal(isVersionAtLeast("20.19.0", "20.19.0"), true);
  assert.equal(isVersionAtLeast("22.1.0", "20.19.0"), true);
  assert.equal(isVersionAtLeast("20.18.9", "20.19.0"), false);
  assert.equal(minimumVersionFromRange(">=20.19.0"), "20.19.0");
});

test("parses machine-readable and strict options", () => {
  const options = parseDoctorArgs(["--cwd", ".", "--json", "--strict", "--no-browser"]);
  assert.equal(options.json, true);
  assert.equal(options.strict, true);
  assert.equal(options.probeBrowser, false);
});

test("reports a ready fixture without failures", async () => {
  const root = createFixture({ build: true, dependencies: true, nvmrc: true });
  try {
    const report = await diagnoseProject({ cwd: root, nodeVersion: "22.0.0", probeBrowser: false });
    assert.equal(report.summary.fail, 0);
    assert.equal(report.checks.find((check) => check.id === "node")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "build")?.status, "pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports actionable failures for an unprepared fixture", async () => {
  const root = createFixture({ build: false, dependencies: false, nvmrc: false });
  try {
    const report = await diagnoseProject({ cwd: root, nodeVersion: "18.0.0", probeBrowser: false });
    assert.ok(report.summary.fail >= 2);
    assert.equal(report.checks.find((check) => check.id === "node")?.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "dependencies")?.fix, "Run: npm ci");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detects a hermetic Playwright Chromium install without importing project code", async () => {
  const root = createFixture({ build: true, dependencies: true, nvmrc: true });
  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    mkdirSync(join(root, "node_modules", "@playwright", "test"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@playwright", "test", "package.json"), "{}\n");
    mkdirSync(
      join(root, "node_modules", "playwright-core", ".local-browsers", "chromium-1234"),
      { recursive: true }
    );
    process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

    const report = await diagnoseProject({ cwd: root, nodeVersion: "22.0.0", probeBrowser: true });
    assert.equal(report.checks.find((check) => check.id === "playwright")?.status, "pass");
  } finally {
    if (previousBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("summarizes status counts", () => {
  assert.deepEqual(
    summarizeChecks([{ status: "pass" }, { status: "warn" }, { status: "fail" }, { status: "info" }]),
    { pass: 1, warn: 1, fail: 1, info: 1, ok: false }
  );
});

function createFixture({ build, dependencies, nvmrc }) {
  const root = mkdtempSync(join(tmpdir(), "openmagic-doctor-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "openmagic-fixture",
    version: "1.0.0",
    engines: { node: ">=20.19.0" },
    scripts: {
      build: "echo build",
      typecheck: "echo typecheck",
      lint: "echo lint",
      test: "echo test",
      "check:all": "echo all",
    },
  }));
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  if (nvmrc) writeFileSync(join(root, ".nvmrc"), "22\n");
  if (dependencies) mkdirSync(join(root, "node_modules"));
  if (build) {
    mkdirSync(join(root, "dist", "toolbar"), { recursive: true });
    writeFileSync(join(root, "dist", "cli.js"), "");
    writeFileSync(join(root, "dist", "toolbar", "index.js"), "");
  }
  return root;
}
