import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSafe, writeFileSafe, cleanupBackups } from "../src/filesystem.js";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(process.cwd(), ".test-fs-advanced");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  cleanupBackups();
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe("CRLF/BOM normalization", () => {
  it("normalizes CRLF to LF on read", () => {
    const filePath = join(TEST_DIR, "crlf.txt");
    writeFileSync(filePath, "line1\r\nline2\r\nline3\r\n");
    const result = readFileSafe(filePath, [TEST_DIR]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.content).toBe("line1\nline2\nline3\n");
      expect(result.content).not.toContain("\r");
    }
  });

  it("strips BOM on read", () => {
    const filePath = join(TEST_DIR, "bom.txt");
    writeFileSync(filePath, "\uFEFFhello world");
    const result = readFileSafe(filePath, [TEST_DIR]);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.content).toBe("hello world");
      expect(result.content.charCodeAt(0)).not.toBe(0xFEFF);
    }
  });

  it("restores CRLF on write after reading CRLF file", () => {
    const filePath = join(TEST_DIR, "restore-crlf.txt");
    writeFileSync(filePath, "a\r\nb\r\nc\r\n");

    // Read (normalizes to LF)
    readFileSafe(filePath, [TEST_DIR]);

    // Write modified content (LF internally)
    writeFileSafe(filePath, "a\nb\nmodified\n", [TEST_DIR]);

    // Verify CRLF was restored
    const raw = readFileSync(filePath, "utf-8");
    expect(raw).toContain("\r\n");
    expect(raw).toBe("a\r\nb\r\nmodified\r\n");
  });

  it("restores BOM on write after reading BOM file", () => {
    const filePath = join(TEST_DIR, "restore-bom.txt");
    writeFileSync(filePath, "\uFEFForiginal content");

    // Read (strips BOM)
    readFileSafe(filePath, [TEST_DIR]);

    // Write
    writeFileSafe(filePath, "new content", [TEST_DIR]);

    // Verify BOM was restored
    const raw = readFileSync(filePath);
    expect(raw[0]).toBe(0xEF);
    expect(raw[1]).toBe(0xBB);
    expect(raw[2]).toBe(0xBF);
  });
});

describe("Atomic writes", () => {
  it("writes successfully and creates backup", () => {
    const filePath = join(TEST_DIR, "atomic.txt");
    writeFileSync(filePath, "original");

    const result = writeFileSafe(filePath, "modified", [TEST_DIR]);
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeTruthy();

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("modified");
  });

  it("does not leave temp files on success", () => {
    const filePath = join(TEST_DIR, "no-temp.txt");
    writeFileSync(filePath, "test");
    writeFileSafe(filePath, "updated", [TEST_DIR]);

    // Check no .openmagic-tmp files exist
    const { readdirSync } = require("node:fs");
    const files = readdirSync(TEST_DIR) as string[];
    const tmpFiles = files.filter((f: string) => f.includes(".openmagic-tmp"));
    expect(tmpFiles.length).toBe(0);
  });
});
