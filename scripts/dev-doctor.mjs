#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const MINIMUM_NODE = "20.19.0";
const LOCKFILES = [
  { file: "package-lock.json", manager: "npm" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
];
const REQUIRED_SCRIPTS = ["build", "typecheck", "lint", "test", "check:all"];

export function parseVersion(value) {
  const match = String(value).trim().match(/^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

export function isVersionAtLeast(current, minimum) {
  const left = parseVersion(current);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function minimumVersionFromRange(range, fallback = MINIMUM_NODE) {
  const match = String(range || "").match(/>=\s*v?(\d+(?:\.\d+){0,2})/);
  return match?.[1] || fallback;
}

export function parseDoctorArgs(argv) {
  const options = {
    cwd: process.cwd(),
    json: false,
    strict: false,
    probeBrowser: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--no-browser") options.probeBrowser = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--cwd") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--cwd requires a path");
      options.cwd = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export async function diagnoseProject({
  cwd = process.cwd(),
  nodeVersion = process.versions.node,
  probeBrowser = true,
} = {}) {
  const root = resolve(cwd);
  const checks = [];
  const packagePath = join(root, "package.json");
  let packageJson = null;

  if (!existsSync(packagePath)) {
    checks.push(fail(
      "package-json",
      "Project manifest",
      `No package.json found in ${root}`,
      "Run this command from the OpenMagic repository root, or pass --cwd <path>."
    ));
  } else {
    try {
      packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      checks.push(pass(
        "package-json",
        "Project manifest",
        `${packageJson.name || basename(root)} (${packageJson.version || "unversioned"})`
      ));
    } catch (error) {
      checks.push(fail(
        "package-json",
        "Project manifest",
        `package.json is invalid JSON: ${error.message}`,
        "Fix package.json before installing dependencies or running checks."
      ));
    }
  }

  const engineRange = packageJson?.engines?.node || `>=${MINIMUM_NODE}`;
  const minimumNode = minimumVersionFromRange(engineRange);
  if (isVersionAtLeast(nodeVersion, minimumNode)) {
    checks.push(pass("node", "Node.js", `v${nodeVersion} satisfies ${engineRange}`));
  } else {
    checks.push(fail(
      "node",
      "Node.js",
      `v${nodeVersion} does not satisfy ${engineRange}`,
      existsSync(join(root, ".nvmrc")) ? "Run: nvm use" : `Install Node.js ${minimumNode} or newer.`
    ));
  }

  const nvmPath = join(root, ".nvmrc");
  if (existsSync(nvmPath)) {
    const requested = readFileSync(nvmPath, "utf8").trim();
    if (isVersionAtLeast(requested, minimumNode)) {
      checks.push(pass("node-pin", "Node version pin", `.nvmrc requests Node ${requested}`));
    } else {
      checks.push(warn(
        "node-pin",
        "Node version pin",
        `.nvmrc requests Node ${requested}, below the supported minimum ${minimumNode}`,
        `Update .nvmrc to ${minimumNode} or newer.`
      ));
    }
  } else {
    checks.push(warn(
      "node-pin",
      "Node version pin",
      "No .nvmrc file found",
      "Add .nvmrc so contributors can select the supported Node version with nvm use."
    ));
  }

  const lockfiles = LOCKFILES.filter(({ file }) => existsSync(join(root, file)));
  if (lockfiles.length === 0) {
    checks.push(warn(
      "lockfile",
      "Package manager",
      "No supported lockfile found",
      "Generate and commit one lockfile; OpenMagic currently uses package-lock.json."
    ));
  } else if (lockfiles.length > 1) {
    checks.push(warn(
      "lockfile",
      "Package manager",
      `Multiple lockfiles found: ${lockfiles.map(({ file }) => file).join(", ")}`,
      "Keep only the lockfile for the package manager used by the repository."
    ));
  } else {
    const [{ file, manager }] = lockfiles;
    checks.push(pass("lockfile", "Package manager", `${manager} (${file})`));
  }

  if (existsSync(join(root, "node_modules"))) {
    checks.push(pass("dependencies", "Dependencies", "node_modules is present"));
  } else {
    const manager = lockfiles[0]?.manager || "npm";
    const install = manager === "npm" ? "npm ci" : `${manager} install`;
    checks.push(fail(
      "dependencies",
      "Dependencies",
      "node_modules is missing",
      `Run: ${install}`
    ));
  }

  if (packageJson?.scripts) {
    const missing = REQUIRED_SCRIPTS.filter((name) => typeof packageJson.scripts[name] !== "string");
    if (missing.length === 0) {
      checks.push(pass(
        "scripts",
        "Development scripts",
        `All required scripts are available: ${REQUIRED_SCRIPTS.join(", ")}`
      ));
    } else {
      checks.push(warn(
        "scripts",
        "Development scripts",
        `Missing scripts: ${missing.join(", ")}`,
        "Restore the standard scripts so local and CI verification stay aligned."
      ));
    }
  }

  const buildFiles = ["dist/cli.js", "dist/toolbar/index.js"];
  const missingBuildFiles = buildFiles.filter((file) => !existsSync(join(root, file)));
  if (missingBuildFiles.length === 0) {
    checks.push(pass("build", "Build output", "CLI and toolbar bundles are present"));
  } else {
    checks.push(warn(
      "build",
      "Build output",
      `Missing ${missingBuildFiles.join(" and ")}`,
      "Run: npm run build"
    ));
  }

  if (probeBrowser && existsSync(join(root, "node_modules"))) {
    checks.push(await diagnosePlaywrightBrowser(root));
  } else if (!probeBrowser) {
    checks.push(info("playwright", "Playwright browser", "Browser probe skipped (--no-browser)"));
  } else {
    checks.push(info("playwright", "Playwright browser", "Browser probe skipped until dependencies are installed"));
  }

  const gitProbe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (gitProbe.status === 0 && gitProbe.stdout.trim() === "true") {
    checks.push(pass("git", "Git checkout", "Repository metadata is available"));
  } else {
    checks.push(info(
      "git",
      "Git checkout",
      "This appears to be a source archive rather than a Git checkout"
    ));
  }

  return {
    projectRoot: root,
    nodeVersion,
    platform: process.platform,
    checks,
    summary: summarizeChecks(checks),
  };
}

async function diagnosePlaywrightBrowser(root) {
  try {
    const requireFromRoot = createRequire(join(root, "package.json"));
    const moduleUrl = pathToFileURL(requireFromRoot.resolve("@playwright/test")).href;
    const { chromium } = await import(moduleUrl);
    const executable = chromium.executablePath();
    if (executable && existsSync(executable)) {
      return pass("playwright", "Playwright browser", `Chromium is installed at ${compactHome(executable)}`);
    }
    return warn(
      "playwright",
      "Playwright browser",
      "Chromium is not installed",
      "Run: npx playwright install chromium"
    );
  } catch {
    return warn(
      "playwright",
      "Playwright browser",
      "Could not load @playwright/test or locate Chromium",
      "Run: npm ci && npx playwright install chromium"
    );
  }
}

export function summarizeChecks(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const check of checks) summary[check.status] += 1;
  return { ...summary, ok: summary.fail === 0 };
}

export function formatReport(report, { color = supportsColor() } = {}) {
  const paint = createPainter(color);
  const icons = {
    pass: paint.green("✓"),
    warn: paint.yellow("▲"),
    fail: paint.red("✗"),
    info: paint.dim("•"),
  };
  const lines = [
    paint.bold("OpenMagic developer doctor"),
    paint.dim(report.projectRoot),
    "",
  ];

  for (const check of report.checks) {
    lines.push(`${icons[check.status]} ${paint.bold(check.title)} — ${check.detail}`);
    if (check.fix) lines.push(`  ${paint.cyan("Fix:")} ${check.fix}`);
  }

  lines.push("");
  const summaryText = [
    `${report.summary.pass} passed`,
    `${report.summary.warn} warning${report.summary.warn === 1 ? "" : "s"}`,
    `${report.summary.fail} failure${report.summary.fail === 1 ? "" : "s"}`,
  ].join(", ");
  const renderSummary = report.summary.fail > 0
    ? paint.red
    : report.summary.warn > 0
      ? paint.yellow
      : paint.green;
  lines.push(renderSummary(summaryText));
  lines.push(paint.dim("Use --json for machine-readable output or --strict to fail on warnings."));
  return lines.join("\n");
}

function makeCheck(status, id, title, detail, fix) {
  return { status, id, title, detail, ...(fix ? { fix } : {}) };
}
function pass(id, title, detail) { return makeCheck("pass", id, title, detail); }
function warn(id, title, detail, fix) { return makeCheck("warn", id, title, detail, fix); }
function fail(id, title, detail, fix) { return makeCheck("fail", id, title, detail, fix); }
function info(id, title, detail) { return makeCheck("info", id, title, detail); }

function compactHome(path) {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function supportsColor() {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

function createPainter(enabled) {
  const wrap = (code) => (value) => enabled ? `\u001b[${code}m${value}\u001b[0m` : String(value);
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    red: wrap("31"),
    green: wrap("32"),
    yellow: wrap("33"),
    cyan: wrap("36"),
  };
}

function printHelp() {
  process.stdout.write(`Usage: npm run doctor -- [options]\n\nDiagnose the OpenMagic contributor environment without external dependencies.\n\nOptions:\n  --cwd <path>    Diagnose another checkout\n  --json          Print machine-readable JSON\n  --strict        Exit non-zero when warnings are present\n  --no-browser    Skip the Playwright Chromium probe\n  -h, --help      Show this help\n`);
}

async function main() {
  let options;
  try {
    options = parseDoctorArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\nRun with --help to see supported options.\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  const report = await diagnoseProject(options);
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${formatReport(report)}\n`);

  const shouldFail = report.summary.fail > 0 || (options.strict && report.summary.warn > 0);
  if (shouldFail) process.exitCode = 1;
}

const directRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directRun) await main();
