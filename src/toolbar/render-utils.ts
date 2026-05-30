export function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DiffRow {
  kind: "context" | "del" | "ins";
  oldNo?: number;
  newNo?: number;
  text: string;
}

const DIFF_MAX_LINES = 600; // bound the O(n*m) LCS for pathological inputs

// LCS line alignment so unchanged interior lines stay as context (correctly
// numbered per side) and only true changes show as del/ins — a real diff, not a
// prefix/suffix heuristic.
export function computeLineDiff(before: string, after: string): DiffRow[] {
  const a = before.split("\n").slice(0, DIFF_MAX_LINES);
  const b = after.split("\n").slice(0, DIFF_MAX_LINES);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0, j = 0, oldNo = 1, newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", oldNo: oldNo++, text: a[i] });
      i++;
    } else {
      rows.push({ kind: "ins", newNo: newNo++, text: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "del", oldNo: oldNo++, text: a[i++] });
  while (j < m) rows.push({ kind: "ins", newNo: newNo++, text: b[j++] });
  return rows;
}

const KEYWORDS = "const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|implements|interface|type|enum|import|export|from|as|new|await|async|yield|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|this|super|static|public|private|protected|readonly|null|true|false|undefined|default";
const TOKEN_RE = new RegExp(
  `(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)` +              // 1: comments
  `|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)` + // 2: strings
  `|\\b(${KEYWORDS})\\b` +                               // 3: keywords
  `|\\b(\\d[\\d._eExXa-fA-F]*)\\b`,                      // 4: numbers
  "g"
);

// Lightweight, XSS-safe syntax highlighting: tokenize the RAW line, escape every
// piece, wrap recognized tokens in classed spans. Keywords inside strings/comments
// are not separately highlighted because those are matched first.
export function highlightCode(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out += escapeHtml(line.slice(last, idx));
    const cls = m[1] ? "comment" : m[2] ? "string" : m[3] ? "keyword" : "number";
    out += `<span class="om-tok-${cls}">${escapeHtml(m[0])}</span>`;
    last = idx + m[0].length;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out;
}

export function renderLineDiff(search: string, replace: string): string {
  const all = computeLineDiff(search, replace);
  const MAX = 80;
  const shown = all.slice(0, MAX);
  const sign = { context: " ", del: "-", ins: "+" } as const;

  const rows = shown.map((r) =>
    `<div class="om-dl om-dl-${r.kind}">` +
    `<span class="om-dl-no">${r.oldNo ?? ""}</span>` +
    `<span class="om-dl-no">${r.newNo ?? ""}</span>` +
    `<span class="om-dl-sign">${sign[r.kind]}</span>` +
    `<span class="om-dl-code">${highlightCode(r.text)}</span>` +
    `</div>`
  );

  if (all.length > MAX) {
    rows.push(`<div class="om-dl om-dl-more">… ${all.length - MAX} more line${all.length - MAX === 1 ? "" : "s"}</div>`);
  }
  return rows.join("");
}

export function renderMarkdown(text: string): string {
  let clean = text.replace(/\\n/g, "\n");
  let html = escapeHtml(clean);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="om-code-block"><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code class="om-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/([^*]|^)\*([^*]+)\*([^*]|$)/g, "$1<em>$2</em>$3");
  html = html.replace(/^- (.+)$/gm, "&#8226; $1");
  html = html.replace(/\n/g, "<br>");
  return html;
}
