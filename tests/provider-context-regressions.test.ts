
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider context and stream regressions", () => {
  it("all streamed cloud adapters flush their final decoder buffer", () => {
    for (const file of ["openai.ts", "anthropic.ts", "google.ts"]) {
      const source = readFileSync(join(process.cwd(), "src", "llm", file), "utf-8");
      expect(source).toContain("decoder.decode()");
    }
  });

  it("CLI and tool-loop prompts retain bounded prior conversation", () => {
    const files = ["tool-loop.ts", "claude-code.ts", "codex-cli.ts", "gemini-cli.ts"];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), "src", "llm", file), "utf-8");
      expect(source).toContain("Previous conversation");
    }
  });
});
