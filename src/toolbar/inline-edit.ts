// U2: direct inline text editing. When the user edits a selected element's text,
// try to produce the code change deterministically (no LLM round-trip) by finding
// the text verbatim in the grounded source. Returns null when it can't be done
// safely (not found / ambiguous / multi-line) so the caller can fall back to a
// focused LLM prompt.

export interface InlineEditResult {
  file: string;
  search: string;
  replace: string;
}

export function buildTextEditModification(
  files: Array<{ path: string; content: string }>,
  oldText: string,
  newText: string
): InlineEditResult | null {
  const needle = oldText;
  if (!needle.trim() || needle === newText || needle.includes("\n")) return null;

  const matches: Array<{ file: string; idx: number; lines: string[] }> = [];
  for (const f of files) {
    const lines = f.content.split("\n");
    lines.forEach((line, idx) => {
      if (line.includes(needle)) matches.push({ file: f.path, idx, lines });
    });
  }

  if (matches.length === 0) return null;

  if (matches.length === 1) {
    const { file, idx, lines } = matches[0];
    const line = lines[idx];
    return { file, search: line, replace: line.replace(needle, newText) };
  }

  // Multiple lines contain the text — disambiguate with a 3-line context block
  // and only change the matched (middle) line. Use it only if the block is unique.
  const blocks = matches.map((m) => {
    const prev = m.idx > 0 ? m.lines[m.idx - 1] : "";
    const mid = m.lines[m.idx];
    const next = m.idx < m.lines.length - 1 ? m.lines[m.idx + 1] : "";
    return {
      file: m.file,
      search: `${prev}\n${mid}\n${next}`,
      replace: `${prev}\n${mid.replace(needle, newText)}\n${next}`,
    };
  });

  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(b.search, (counts.get(b.search) || 0) + 1);
  const unique = blocks.find((b) => counts.get(b.search) === 1);
  return unique ?? null;
}
