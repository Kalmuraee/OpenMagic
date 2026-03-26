import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isPathSafe, readFileSafe, writeFileSafe } from "../src/filesystem.js";

const TEST_DIR = join(process.cwd(), ".test-sandbox");
const OUTSIDE_DIR = join(process.cwd(), ".test-outside");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(OUTSIDE_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "hello.ts"), "console.log('hello');\n");
  writeFileSync(join(OUTSIDE_DIR, "secret.txt"), "secret data\n");
  // Create a symlink escape
  try { symlinkSync(OUTSIDE_DIR, join(TEST_DIR, "escape-link")); } catch {}
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(OUTSIDE_DIR, { recursive: true, force: true });
});

describe("isPathSafe", () => {
  it("allows files inside root", () => {
    expect(isPathSafe(join(TEST_DIR, "hello.ts"), [TEST_DIR])).toBe(true);
  });

  it("rejects path traversal with ..", () => {
    expect(isPathSafe(join(TEST_DIR, "../../etc/passwd"), [TEST_DIR])).toBe(false);
  });

  it("rejects sibling directory", () => {
    expect(isPathSafe(OUTSIDE_DIR + "/secret.txt", [TEST_DIR])).toBe(false);
  });

  it("rejects symlink escape", () => {
    const linkPath = join(TEST_DIR, "escape-link", "secret.txt");
    expect(isPathSafe(linkPath, [TEST_DIR])).toBe(false);
  });
});

describe("readFileSafe", () => {
  it("reads file inside root", () => {
    const result = readFileSafe(join(TEST_DIR, "hello.ts"), [TEST_DIR]);
    expect("content" in result).toBe(true);
    if ("content" in result) expect(result.content).toContain("hello");
  });

  it("rejects file outside root", () => {
    const result = readFileSafe(join(OUTSIDE_DIR, "secret.txt"), [TEST_DIR]);
    expect("error" in result).toBe(true);
  });
});

describe("writeFileSafe", () => {
  it("writes file inside root", () => {
    const result = writeFileSafe(join(TEST_DIR, "new.ts"), "new content", [TEST_DIR]);
    expect(result.ok).toBe(true);
  });

  it("rejects write outside root", () => {
    const result = writeFileSafe(join(OUTSIDE_DIR, "hack.txt"), "hacked", [TEST_DIR]);
    expect(result.ok).toBe(false);
  });
});
