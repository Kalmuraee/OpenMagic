from pathlib import Path
import re

ROOT = Path.cwd()

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value.rstrip() + "\n", encoding="utf-8")

# The generic grep operation used by the browser retry loop must search every
# configured root and preserve root-qualified display paths.
server = read("src/server.ts")
old = '''    case "fs.grep": {
      const payload = msg.payload as { pattern: string; path?: string };
      if (!payload?.pattern) {
        sendError(ws, "invalid_payload", "Missing pattern", msg.id);
        break;
      }
      const searchRoot = payload.path ? join(roots[0] || process.cwd(), payload.path) : (roots[0] || process.cwd());
      const results = grepFiles(payload.pattern, searchRoot, roots);
      send(ws, { id: msg.id, type: "fs.grep.result", payload: { results } });
      break;
    }'''
new = '''    case "fs.grep": {
      const payload = msg.payload as { pattern: string; path?: string };
      if (!payload?.pattern) {
        sendError(ws, "invalid_payload", "Missing pattern", msg.id);
        break;
      }
      let results: Array<{ file: string; lineNum: number; line: string }> = [];
      if (payload.path) {
        const resolved = resolveProjectPath(payload.path, roots, { mustExist: true });
        if ("error" in resolved) { sendError(ws, "fs_error", resolved.error, msg.id); break; }
        results = grepFiles(payload.pattern, resolved.absolutePath, [resolved.root])
          .map((match) => ({ ...match, file: displayPathFor(resolved.root, match.file, roots) }));
      } else {
        results = roots.flatMap((root) => grepFiles(payload.pattern, root, [root])
          .map((match) => ({ ...match, file: displayPathFor(root, match.file, roots) })));
      }
      send(ws, { id: msg.id, type: "fs.grep.result", payload: { results } });
      break;
    }'''
if old in server:
    server = server.replace(old, new, 1)
else:
    # Formatting-tolerant replacement.
    pattern = re.compile(r'    case "fs\.grep": \{.*?\n      break;\n    \}', re.S)
    server, count = pattern.subn(new, server, count=1)
    if count != 1:
        raise RuntimeError("fs.grep case not found")
write("src/server.ts", server)

# Native model tools resolve qualified paths against all roots instead of blindly
# joining them to roots[0].
tools = read("src/llm/tools.ts")
if 'from "../root-resolver.js"' not in tools:
    tools = tools.replace(
        'import type { CodeModification } from "../shared-types.js";',
        'import type { CodeModification } from "../shared-types.js";\nimport { displayPathFor, resolveProjectPath } from "../root-resolver.js";',
        1,
    )
tools = tools.replace(
    'description: "Read the full, exact contents of a source file (path relative to the project root). Use this before proposing an edit so your search block matches byte-for-byte.",',
    'description: "Read an exact page of a source file. Use offset/limit repeatedly until no MORE_AVAILABLE marker remains before proposing a byte-exact edit.",',
)
old_read = '''      const rel = String(args.path || "");
      const read = readFileSafe(join(root, rel), roots);
      if ("error" in read) return { content: `Error reading ${rel}: ${read.error}` };'''
new_read = '''      const rel = String(args.path || "");
      const resolved = resolveProjectPath(rel, roots, { mustExist: true });
      if ("error" in resolved) return { content: `Error reading ${rel}: ${resolved.error}` };
      const read = readFileSafe(resolved.absolutePath, [resolved.root]);
      if ("error" in read) return { content: `Error reading ${rel}: ${read.error}` };'''
if old_read not in tools:
    raise RuntimeError("tool read resolver block not found")
tools = tools.replace(old_read, new_read, 1)
tools = tools.replace('`Contents of ${rel} [${offset}:${offset + chunk.length}]', '`Contents of ${resolved.displayPath} [${offset}:${offset + chunk.length}]', 1)
old_search = '''      const pattern = String(args.pattern || "");
      const sub = args.path ? join(root, String(args.path)) : root;
      const results = grepFiles(pattern, sub, roots);
      if (!results.length) return { content: `No matches for "${pattern}".` };
      return { content: results.map((r) => `${r.file}:${r.lineNum}: ${r.line}`).join("\\n") };'''
new_search = '''      const pattern = String(args.pattern || "");
      let results: Array<{ file: string; lineNum: number; line: string }> = [];
      if (args.path) {
        const resolved = resolveProjectPath(String(args.path), roots, { mustExist: true });
        if ("error" in resolved) return { content: `Search path error: ${resolved.error}` };
        results = grepFiles(pattern, resolved.absolutePath, [resolved.root])
          .map((match) => ({ ...match, file: displayPathFor(resolved.root, match.file, roots) }));
      } else {
        results = roots.flatMap((candidate) => grepFiles(pattern, candidate, [candidate])
          .map((match) => ({ ...match, file: displayPathFor(candidate, match.file, roots) })));
      }
      if (!results.length) return { content: `No matches for "${pattern}".` };
      return { content: results.map((r) => `${r.file}:${r.lineNum}: ${r.line}`).join("\\n") };'''
if old_search not in tools:
    raise RuntimeError("tool search block not found")
tools = tools.replace(old_search, new_search, 1)
old_list = '''      const dir = args.path ? join(root, String(args.path)) : root;
      const entries = listFiles(dir, roots, 3);
      if (!entries.length) return { content: "No files found." };
      return { content: entries.map((e) => `${e.type === "dir" ? "[dir] " : ""}${e.path}`).join("\\n") };'''
new_list = '''      if (args.path) {
        const resolved = resolveProjectPath(String(args.path), roots, { mustExist: true });
        if ("error" in resolved) return { content: `List path error: ${resolved.error}` };
        const entries = listFiles(resolved.absolutePath, [resolved.root], 3);
        if (!entries.length) return { content: "No files found." };
        return { content: entries.map((entry) => `${entry.type === "dir" ? "[dir] " : ""}${displayPathFor(resolved.root, entry.path, roots)}`).join("\\n") };
      }
      const entries = roots.flatMap((candidate) => listFiles(candidate, [candidate], 3)
        .map((entry) => ({ ...entry, path: displayPathFor(candidate, entry.path, roots) })));
      if (!entries.length) return { content: "No files found." };
      return { content: entries.map((entry) => `${entry.type === "dir" ? "[dir] " : ""}${entry.path}`).join("\\n") };'''
if old_list not in tools:
    raise RuntimeError("tool list block not found")
tools = tools.replace(old_list, new_list, 1)
write("src/llm/tools.ts", tools)

# Do not pre-resolve a root-qualified path against roots[0] before sending it to
# the root-aware server.
toolbar = read("src/toolbar/index.ts")
toolbar = toolbar.replace(
    'function resolveFilePath(rel: string): string {\n  return state.roots.length > 0 ? state.roots[0] + "/" + rel : rel;\n}',
    'function resolveFilePath(rel: string): string {\n  if (state.roots.length !== 1 || /^(?:[A-Za-z]:[\\\\/]|\\/)/.test(rel)) return rel;\n  return state.roots[0] + "/" + rel;\n}',
)
write("src/toolbar/index.ts", toolbar)

# A detected server that owns the expected port is accepted even if its root URL
# is temporarily slow/authenticated. Only processes OpenMagic itself spawned are
# ever cleaned up.
cli = read("src/cli.ts")
pattern = re.compile(r'      if \(detected && detected\.fromScripts\) \{.*?\n      \} else if \(detected && !detected\.fromScripts\) \{', re.S)
match = pattern.search(cli)
if match:
    replacement = '''      if (detected && detected.fromScripts) {
        targetPort = detected.port;
        targetHost = detected.host;
        const frameworkLabel = getDetectedFrameworkLabel() ?? "dev server";
        const healthy = await isPortHealthy(detected.host, detected.port);
        if (healthy) finishInlineStatus(`Found ${frameworkLabel} on port ${detected.port}`);
        else warnInlineStatus(`Found ${frameworkLabel} on port ${detected.port}; HTTP readiness will be checked without terminating it`);
      } else if (detected && !detected.fromScripts) {'''
    cli = cli[:match.start()] + replacement + cli[match.end():]
else:
    raise RuntimeError("detected server branch not found")
write("src/cli.ts", cli)

# Keep TypeScript tests valid when buildGoogleRequest is typed as a generic
# record: cast generationConfig before dereferencing it.
for path in ["tests/thinking.test.ts", "tests/llm-request-build.test.ts", "tests/provider-execution.test.ts"]:
    target = ROOT / path
    if not target.exists():
        continue
    source = target.read_text(encoding="utf-8")
    source = source.replace("body.generationConfig.thinkingConfig", "(body.generationConfig as any).thinkingConfig")
    source = source.replace("request.generationConfig.thinkingConfig", "(request.generationConfig as any).thinkingConfig")
    source = source.replace("result.generationConfig.thinkingConfig", "(result.generationConfig as any).thinkingConfig")
    target.write_text(source, encoding="utf-8")

# Extend the existing regression suite with a real secondary-root tool read.
test_path = ROOT / "tests/audit-regressions.test.ts"
if test_path.exists():
    tests = test_path.read_text(encoding="utf-8")
    marker = '  it("returns exact paged file chunks", () => {'
    if marker in tests and "reads an explicitly qualified secondary root" not in tests:
        addition = '''  it("reads an explicitly qualified secondary root through model tools", () => {
    const a = temp("om-tool-root-a-");
    const b = temp("om-tool-root-b-");
    writeFileSync(join(b, "secondary.txt"), "from-secondary");
    const alias = b.split(/[\\\\/]/).pop()!;
    const result = executeServerTool("read_file", { path: `${alias}/secondary.txt` }, a, [a, b]);
    expect(result.content).toContain("from-secondary");
  });

'''
        tests = tests.replace(marker, addition + marker, 1)
        test_path.write_text(tests, encoding="utf-8")

print("Multi-root runtime follow-up completed")
