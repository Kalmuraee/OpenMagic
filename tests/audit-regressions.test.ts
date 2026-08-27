
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderApiKey } from "../src/config.js";
import { resolveProjectPath } from "../src/root-resolver.js";
import { readFileSafe, writeFileSafe } from "../src/filesystem.js";
import { buildGoogleRequest } from "../src/llm/google.js";
import { buildOpenAICompatibleRequest } from "../src/llm/openai.js";
import { buildAnthropicRequest } from "../src/llm/anthropic.js";
import { executeServerTool } from "../src/llm/tools.js";
import { createNativeEditSession, captureNativeEditSession, closeNativeEditSession } from "../src/llm/native-capture.js";
import { resolveStaticRequestPath } from "../src/static-server.js";
import { detectVerifyScripts } from "../src/verify.js";

const dirs: string[] = [];
const temp = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("full audit regressions", () => {
  it("never falls back to another provider's key", () => {
    const config = { provider: "openai", apiKey: "legacy", apiKeys: { openai: "sk-openai" } };
    expect(getProviderApiKey(config, "openai")).toBe("sk-openai");
    expect(getProviderApiKey(config, "anthropic")).toBe("");
  });

  it("resolves explicit and existing paths across multiple roots", () => {
    const a = temp("om-root-a-");
    const b = temp("om-root-b-");
    mkdirSync(join(b, "src"));
    writeFileSync(join(b, "src", "App.tsx"), "export {}\n");
    const found = resolveProjectPath("src/App.tsx", [a, b], { mustExist: true });
    expect("error" in found).toBe(false);
    if (!("error" in found)) expect(found.root).toBe(b);
  });

  it("preserves executable mode across atomic writes", () => {
    if (process.platform === "win32") return;
    const root = temp("om-mode-");
    const file = join(root, "script.sh");
    writeFileSync(file, "#!/bin/sh\necho before\n");
    chmodSync(file, 0o755);
    expect(writeFileSafe(file, "#!/bin/sh\necho after\n", [root]).ok).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o755);
  });

  it("refuses to replace symbolic links", () => {
    if (process.platform === "win32") return;
    const root = temp("om-symlink-");
    const target = join(root, "target.txt");
    const link = join(root, "link.txt");
    writeFileSync(target, "safe");
    execFileSync("ln", ["-s", target, link]);
    const result = writeFileSafe(link, "changed", [root]);
    expect(result.ok).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("safe");
  });

  it("reads an explicitly qualified secondary root through model tools", () => {
    const a = temp("om-tool-root-a-");
    const b = temp("om-tool-root-b-");
    writeFileSync(join(b, "secondary.txt"), "from-secondary");
    const alias = b.split(/[\\/]/).pop()!;
    const result = executeServerTool("read_file", { path: `${alias}/secondary.txt` }, a, [a, b]);
    expect(result.content).toContain("from-secondary");
  });

  it("returns exact paged file chunks", () => {
    const root = temp("om-page-");
    writeFileSync(join(root, "large.txt"), "0123456789abcdef");
    const result = executeServerTool("read_file", { path: "large.txt", offset: 4, limit: 6 }, root, [root]);
    expect(result.content).toContain("456789");
    expect(result.content).toContain("next_offset=10");
  });

  it("puts Google thinking config inside generationConfig and includes every image", () => {
    const body: any = buildGoogleRequest("gemini-3.1-pro-preview", [{ role: "user", content: "change it" }], {
      screenshot: "data:image/png;base64,AAA",
      attachments: ["data:image/jpeg;base64,BBB"],
      reasoningLevel: "high",
    });
    expect(body.thinkingConfig).toBeUndefined();
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBeTruthy();
    const inline = body.contents[0].parts.filter((part: any) => part.inline_data);
    expect(inline).toHaveLength(2);
  });

  it("serializes all images for OpenAI and Anthropic vision requests", () => {
    const context = {
      screenshot: "data:image/png;base64,AAA",
      attachments: ["data:image/jpeg;base64,BBB"],
    };
    const messages = [{ role: "user" as const, content: "inspect" }];
    const openai: any = buildOpenAICompatibleRequest("openai", "gpt-4.1", messages, context);
    expect(openai.messages.at(-1).content.filter((part: any) => part.type === "image_url")).toHaveLength(2);
    const anthropic: any = buildAnthropicRequest("claude-sonnet-4-6", messages, context);
    expect(anthropic.messages.at(-1).content.filter((part: any) => part.type === "image")).toHaveLength(2);
  });

  it("serves index.html as an SPA fallback for extensionless routes", () => {
    const root = temp("om-spa-");
    writeFileSync(join(root, "index.html"), "<main>app</main>");
    expect(resolveStaticRequestPath(root, "/dashboard/settings")).toBe(join(root, "index.html"));
  });

  it("detects every configured verification gate", () => {
    const root = temp("om-verify-");
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc", lint: "eslint .", check: "test -f package.json" } }));
    expect(detectVerifyScripts(root)).toEqual(["typecheck", "lint", "check"]);
  });

  it("runs native edits in an isolated worktree and leaves the source checkout untouched", () => {
    const root = temp("om-native-");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "before\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "base"], { cwd: root });
    const session = createNativeEditSession(root);
    try {
      writeFileSync(join(session.workspace, "file.txt"), "after\n");
      const mods = captureNativeEditSession(session);
      expect(mods).toHaveLength(1);
      expect(readFileSafe(join(root, "file.txt"), [root])).toEqual({ content: "before\n" });
    } finally {
      closeNativeEditSession(session);
    }
    expect(existsSync(join(root, ".git"))).toBe(true);
  });
});
