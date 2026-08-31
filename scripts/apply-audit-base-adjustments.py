from pathlib import Path

ROOT = Path.cwd()

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value.rstrip() + "\n", encoding="utf-8")

# Existing request-construction tests encoded the old, provider-invalid top-level
# Google thinkingConfig. Update them to assert the supported generationConfig
# location while preserving all other expectations.
for path in ["tests/thinking.test.ts", "tests/llm-request-build.test.ts", "tests/provider-execution.test.ts"]:
    target = ROOT / path
    if target.exists():
        source = target.read_text(encoding="utf-8")
        source = source.replace("body.thinkingConfig", "body.generationConfig.thinkingConfig")
        source = source.replace("request.thinkingConfig", "request.generationConfig.thinkingConfig")
        source = source.replace("result.thinkingConfig", "result.generationConfig.thinkingConfig")
        target.write_text(source, encoding="utf-8")

# An aborted child still has to settle the adapter Promise after process close.
for path in ["src/llm/claude-code.ts", "src/llm/codex-cli.ts", "src/llm/gemini-cli.ts"]:
    source = read(path)
    source = source.replace(
        "    if (aborted) return; // client cancelled — stay silent",
        "    if (aborted) { settle(); return; } // client cancelled — settle without callbacks",
    )
    write(path, source)

# Ensure root-aware provider calls include all configured roots in both normal and
# server-agent paths even when formatting changed around the original replacement.
server_path = ROOT / "src/server.ts"
if server_path.exists():
    server = server_path.read_text(encoding="utf-8")
    server = server.replace("root: roots[0],\n          roots,\n          roots,", "root: roots[0],\n          roots,")
    server_path.write_text(server, encoding="utf-8")

# The previous proxy tests intentionally expected HTML wrapping of JSON errors.
# That behavior is the audited bug; assert byte-compatible passthrough instead.
proxy_test = ROOT / "tests/proxy.test.ts"
if proxy_test.exists():
    source = proxy_test.read_text(encoding="utf-8")
    source = source.replace("wraps non-HTML error responses with toolbar HTML", "passes non-HTML error responses through unchanged")
    source = source.replace("expect(body).toContain(\"This error is from your dev server\")", "expect(body).not.toContain(\"This error is from your dev server\")")
    proxy_test.write_text(source, encoding="utf-8")

print("Audit base adjustments applied")
