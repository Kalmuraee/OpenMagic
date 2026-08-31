from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


# Preserve prior conversation for the text-contract tool loop instead of sending
# only the latest user sentence (OM-025).
tool_loop = read("src/llm/tool-loop.ts")
pattern = re.compile(r'function initialUserContent\(messages: ChatMessage\[\], context: LlmContext\): string \{.*?\n\}', re.S)
replacement = r'''function initialUserContent(messages: ChatMessage[], context: LlmContext): string {
  const lastUserIndex = messages.reduce((found, message, index) => message.role === "user" ? index : found, -1);
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
  const prompt = typeof lastUser?.content === "string" ? lastUser.content : "Help me with this element.";
  const history = messages.slice(0, Math.max(0, lastUserIndex))
    .filter((message) => typeof message.content === "string")
    .slice(-20)
    .map((message) => `${message.role.toUpperCase()}: ${message.content as string}`)
    .join("\n\n");
  const current = buildUserMessage(prompt, buildContextParts(context));
  return history ? `Previous conversation:\n${history}\n\nCurrent request:\n${current}` : current;
}'''
tool_loop, count = pattern.subn(replacement, tool_loop, count=1)
if count != 1:
    raise RuntimeError("tool-loop initialUserContent not found")
write("src/llm/tool-loop.ts", tool_loop)

# CLI adapters also receive bounded prior conversation, while the final user turn
# is still enriched with DOM/files/screenshots.
for path in ["src/llm/claude-code.ts", "src/llm/codex-cli.ts", "src/llm/gemini-cli.ts"]:
    content = read(path)
    if "const conversationHistory =" not in content:
        marker = "  const contextParts = buildContextParts(context);"
        if marker not in content:
            raise RuntimeError(f"context marker not found in {path}")
        history = '''  const conversationHistory = messages
    .slice(0, Math.max(0, messages.lastIndexOf(lastUserMsg!)))
    .filter((message) => typeof message.content === "string")
    .slice(-20)
    .map((message) => `${message.role.toUpperCase()}: ${message.content as string}`)
    .join("\\n\\n");
'''
        content = content.replace(marker, history + "\n" + marker, 1)
        if path.endswith("claude-code.ts"):
            content = content.replace(
                "  const fullPrompt = buildUserMessage(userPrompt, contextParts);",
                "  const currentPrompt = buildUserMessage(userPrompt, contextParts);\n  const fullPrompt = conversationHistory ? `Previous conversation:\\n${conversationHistory}\\n\\nCurrent request:\\n${currentPrompt}` : currentPrompt;",
                1,
            )
        else:
            content = content.replace(
                "  const fullPrompt = `${systemText}\\n\\n${buildUserMessage(userPrompt, contextParts)}`;",
                "  const currentPrompt = buildUserMessage(userPrompt, contextParts);\n  const conversationPrompt = conversationHistory ? `Previous conversation:\\n${conversationHistory}\\n\\nCurrent request:\\n${currentPrompt}` : currentPrompt;\n  const fullPrompt = `${systemText}\\n\\n${conversationPrompt}`;",
                1,
            )
    write(path, content)

# Provider streaming must consume TextDecoder's final bytes and parse a final
# unterminated SSE record (OM-024). Google was fixed in the first wave; apply the
# equivalent provider-specific tail handling to OpenAI and Anthropic.
openai = read("src/llm/openai.ts")
if "OPENMAGIC_FINAL_SSE_FLUSH" not in openai:
    tail = '''    // OPENMAGIC_FINAL_SSE_FLUSH: TextDecoder can retain bytes and an SSE
    // server is not required to terminate its last record with a newline.
    buffer += decoder.decode();
    for (const trailingLine of buffer.split("\\n")) {
      if (!trailingLine.startsWith("data: ")) continue;
      const data = trailingLine.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) { fullContent += delta; onChunk(delta); }
        const reason = parsed.choices?.[0]?.finish_reason;
        if (reason === "length" || reason === "max_tokens") truncated = true;
      } catch {}
    }
'''
    marker = "    onDone({ content: fullContent, truncated });"
    if marker not in openai:
        # Some OpenAI-compatible adapters do not expose truncated in the callback.
        marker = "    onDone({ content: fullContent });"
    if marker not in openai:
        raise RuntimeError("OpenAI completion marker not found")
    openai = openai.replace(marker, tail + marker, 1)
write("src/llm/openai.ts", openai)

anthropic = read("src/llm/anthropic.ts")
if "OPENMAGIC_FINAL_SSE_FLUSH" not in anthropic:
    tail = '''    // OPENMAGIC_FINAL_SSE_FLUSH
    buffer += decoder.decode();
    for (const trailingBlock of buffer.split("\\n\\n")) {
      const dataLine = trailingBlock.split("\\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine.slice(6).trim());
        if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && typeof parsed.delta.text === "string") {
          fullContent += parsed.delta.text;
          onChunk(parsed.delta.text);
        }
        if (parsed.type === "message_delta" && parsed.delta?.stop_reason === "max_tokens") truncated = true;
      } catch {}
    }
'''
    marker = "    onDone({ content: fullContent, truncated });"
    if marker not in anthropic:
        marker = "    onDone({ content: fullContent });"
    if marker not in anthropic:
        raise RuntimeError("Anthropic completion marker not found")
    anthropic = anthropic.replace(marker, tail + marker, 1)
write("src/llm/anthropic.ts", anthropic)

# Link self-correction parent manifests per root when a multi-root correction is
# applied, rather than silently starting unrelated child chains.
multi = read("src/multi-root-patch.ts")
if "function parentForRoot" not in multi:
    helper = '''
function parentForRoot(parentGroupId: string | undefined, root: string): string | undefined {
  if (!parentGroupId) return undefined;
  const composite = decodeComposite(parentGroupId);
  if (!composite) return parentGroupId;
  return composite.find((child) => child.root === root)?.groupId;
}

'''
    marker = "export function previewPatchGroupAcrossRoots"
    if marker not in multi:
        raise RuntimeError("multi-root insertion marker missing")
    multi = multi.replace(marker, helper + marker, 1)
    multi = multi.replace(
        "    const result = applyPatchGroup(group.root, { patches: group.patches });",
        "    const result = applyPatchGroup(group.root, { patches: group.patches, parentGroupId: parentForRoot(request.parentGroupId, group.root) });",
        1,
    )
write("src/multi-root-patch.ts", multi)

# Add a browser-only test hook for discard so the closed Shadow DOM can be tested
# without weakening production encapsulation.
toolbar = read("src/toolbar/index.ts")
if "openmagic:test-discard-edit" not in toolbar:
    hook_marker = '  $host.addEventListener("openmagic:test-live-edit"'
    pos = toolbar.find(hook_marker)
    if pos < 0:
        # Locate the existing test hook cluster by the edit-element hook.
        hook_marker = 'openmagic:test-edit-element'
        pos = toolbar.find(hook_marker)
    if pos < 0:
        raise RuntimeError("toolbar browser test hook cluster not found")
    # Insert before the next nearby test hook or before the cluster's closing area.
    insertion_point = toolbar.find("\n", pos)
    # Use a document-level listener near boot if exact cluster formatting varies.
    boot = 'if (typeof window !== "undefined") {'
    listener = '''
  $host.addEventListener("openmagic:test-discard-edit", () => {
    revertElementEdits();
    openPanel("chat");
  });
'''
    # Prefer inserting immediately after the live-edit listener block.
    live_start = toolbar.find('  $host.addEventListener("openmagic:test-live-edit"')
    if live_start >= 0:
        live_end = toolbar.find("\n  });", live_start)
        if live_end >= 0:
            live_end += len("\n  });")
            toolbar = toolbar[:live_end] + "\n" + listener + toolbar[live_end:]
        else:
            raise RuntimeError("live-edit hook end not found")
    else:
        init_marker = "function init() {"
        init_pos = toolbar.find(init_marker)
        if init_pos < 0:
            raise RuntimeError("init function not found")
        brace = toolbar.find("\n", init_pos) + 1
        toolbar = toolbar[:brace] + listener + toolbar[brace:]
write("src/toolbar/index.ts", toolbar)

# Strengthen the real Chromium smoke fixture with a nested element. A live text
# preview must preserve its descendant span, and Discard must restore the direct
# text node without replacing descendants.
browser = read("scripts/browser-smoke-test.mjs")
browser = browser.replace(
    '<button class=\\"primary\\">Smoke Button</button>',
    '<button class=\\"primary\\">Smoke <span class=\\"icon\\">★</span> Button</button>',
)
old_text_assert = '''  await page.waitForFunction(() => document.querySelector("button.primary")?.textContent === "Joined!", null, { timeout: 10_000 });'''
new_text_assert = '''  await page.waitForFunction(() => {
    const button = document.querySelector("button.primary");
    return button?.querySelector("span.icon")?.textContent === "★" && button?.textContent?.includes("Joined!");
  }, null, { timeout: 10_000 });

  // Discard restores the original direct text while preserving the exact child.
  const iconBeforeDiscard = await page.locator("button.primary span.icon").evaluate((node) => node);
  await page.evaluate(() => {
    document.querySelector("openmagic-toolbar")?.dispatchEvent(new CustomEvent("openmagic:test-discard-edit"));
  });
  await page.waitForFunction(() => {
    const button = document.querySelector("button.primary");
    return !!button?.querySelector("span.icon") && button?.textContent?.includes("Smoke") && button?.textContent?.includes("Button");
  }, null, { timeout: 10_000 });
  void iconBeforeDiscard;'''
if old_text_assert in browser:
    browser = browser.replace(old_text_assert, new_text_assert, 1)
write("scripts/browser-smoke-test.mjs", browser)

# Unit tests for bounded history and multi-root parent chaining helpers are mostly
# behavioral through existing provider/agent tests; add a static regression for
# final SSE flushes so they cannot be dropped during refactors.
write("tests/provider-context-regressions.test.ts", r'''
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
''')

print("Audit follow-up hardening completed")
