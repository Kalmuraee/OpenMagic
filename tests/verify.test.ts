import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectVerifyScript,
  attributeToTouched,
  verifyTouchedFiles,
  runVerifyScript,
  verifyPatchGroup,
} from "../src/verify.js";

const ROOT = join(process.cwd(), ".test-verify-root");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});
afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function pkg(scripts: Record<string, string>) {
  writeFileSync(join(ROOT, "package.json"), JSON.stringify({ name: "t", scripts }));
}

describe("detectVerifyScript", () => {
  it("prefers a typecheck script over lint", () => {
    pkg({ lint: "eslint .", typecheck: "tsc --noEmit", build: "tsup" });
    expect(detectVerifyScript(ROOT)?.script).toBe("typecheck");
  });
  it("falls back to lint when there is no typecheck", () => {
    pkg({ lint: "eslint .", build: "tsup" });
    expect(detectVerifyScript(ROOT)?.script).toBe("lint");
  });
  it("returns null when there is no verify-like script", () => {
    pkg({ build: "tsup", start: "node ." });
    expect(detectVerifyScript(ROOT)).toBeNull();
  });
  it("returns null when there is no package.json", () => {
    expect(detectVerifyScript(ROOT)).toBeNull();
  });
});

describe("attributeToTouched", () => {
  it("matches by full path and by basename", () => {
    expect(attributeToTouched("src/App.tsx(12,3): error TS2322", ["src/App.tsx"])).toBe(true);
    expect(attributeToTouched("ERROR in ./components/Button.tsx 5:1", ["src/components/Button.tsx"])).toBe(true);
  });
  it("does not match unrelated files", () => {
    expect(attributeToTouched("src/Other.tsx: error TS2322", ["src/App.tsx"])).toBe(false);
  });
});

describe("verifyTouchedFiles", () => {
  it("flags a touched JSON file that is now invalid", () => {
    writeFileSync(join(ROOT, "broken.json"), "{ not: valid, }");
    const r = verifyTouchedFiles(ROOT, ["broken.json"]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("broken.json");
  });
  it("passes valid JSON and ignores non-JSON files", () => {
    writeFileSync(join(ROOT, "ok.json"), JSON.stringify({ a: 1 }));
    writeFileSync(join(ROOT, "code.ts"), "const x: number = 1;");
    expect(verifyTouchedFiles(ROOT, ["ok.json", "code.ts"]).ok).toBe(true);
  });
});

describe("runVerifyScript", () => {
  it("reports success for a script that exits 0", async () => {
    pkg({ ok: "node -e \"process.exit(0)\"" });
    const r = await runVerifyScript(ROOT, "ok", 15000);
    expect(r.code).toBe(0);
    expect(r.timedOut).toBe(false);
  }, 20_000);
  it("captures failure output for a script that exits non-zero", async () => {
    pkg({ bad: "node -e \"console.log('boom err'); process.exit(1)\"" });
    const r = await runVerifyScript(ROOT, "bad", 15000);
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("boom");
  }, 20_000);
  it("times out a long-running script", async () => {
    pkg({ slow: "node -e \"setTimeout(()=>{}, 10000)\"" });
    const r = await runVerifyScript(ROOT, "slow", 500);
    expect(r.timedOut).toBe(true);
  });
});

describe("verifyPatchGroup", () => {
  it("is inconclusive when the project has no verify script", async () => {
    pkg({ build: "tsup" });
    const r = await verifyPatchGroup(ROOT, { files: ["a.ts"] });
    expect(r.status).toBe("inconclusive");
  });

  it("passes when the typecheck script succeeds", async () => {
    pkg({ typecheck: "node -e \"process.exit(0)\"" });
    const r = await verifyPatchGroup(ROOT, { files: ["a.ts"], timeoutMs: 15000 });
    expect(r.status).toBe("passed");
    expect(r.ran).toContain("typecheck");
  });

  it("fails when the script errors and the output blames a touched file", async () => {
    pkg({ typecheck: "node -e \"console.log('src/a.ts(1,1): error TS1005'); process.exit(2)\"" });
    const r = await verifyPatchGroup(ROOT, { files: ["src/a.ts"], timeoutMs: 15000 });
    expect(r.status).toBe("failed");
    expect(r.errors.join(" ")).toContain("a.ts");
  });

  it("is inconclusive when the script errors but blames unrelated files (pre-existing)", async () => {
    pkg({ typecheck: "node -e \"console.log('src/unrelated.ts(1,1): error TS1005'); process.exit(2)\"" });
    const r = await verifyPatchGroup(ROOT, { files: ["src/a.ts"], timeoutMs: 15000 });
    expect(r.status).toBe("inconclusive");
  });
});
