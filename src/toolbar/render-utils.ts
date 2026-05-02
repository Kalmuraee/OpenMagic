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

export function renderLineDiff(search: string, replace: string): string {
  const searchLines = search.split("\n");
  const replaceLines = replace.split("\n");
  const lines: string[] = [];
  const maxLines = 30;

  const sLen = Math.min(searchLines.length, maxLines);
  const rLen = Math.min(replaceLines.length, maxLines);

  let commonPrefix = 0;
  while (commonPrefix < sLen && commonPrefix < rLen && searchLines[commonPrefix] === replaceLines[commonPrefix]) commonPrefix++;
  let commonSuffix = 0;
  while (commonSuffix < sLen - commonPrefix && commonSuffix < rLen - commonPrefix
    && searchLines[sLen - 1 - commonSuffix] === replaceLines[rLen - 1 - commonSuffix]) commonSuffix++;

  for (let i = 0; i < commonPrefix; i++) {
    lines.push(`<div class="om-diff-line om-diff-ctx"><span class="om-diff-ln">${i + 1}</span><span class="om-diff-sign"> </span>${escapeHtml(searchLines[i])}</div>`);
  }

  for (let i = commonPrefix; i < sLen - commonSuffix; i++) {
    lines.push(`<div class="om-diff-line om-diff-del"><span class="om-diff-ln">${i + 1}</span><span class="om-diff-sign">-</span>${escapeHtml(searchLines[i])}</div>`);
  }

  for (let i = commonPrefix; i < rLen - commonSuffix; i++) {
    lines.push(`<div class="om-diff-line om-diff-ins"><span class="om-diff-ln"> </span><span class="om-diff-sign">+</span>${escapeHtml(replaceLines[i])}</div>`);
  }

  for (let i = sLen - commonSuffix; i < sLen; i++) {
    lines.push(`<div class="om-diff-line om-diff-ctx"><span class="om-diff-ln">${i + 1}</span><span class="om-diff-sign"> </span>${escapeHtml(searchLines[i])}</div>`);
  }

  if (searchLines.length > maxLines) lines.push(`<div class="om-diff-line om-diff-ctx">... ${searchLines.length - maxLines} more lines</div>`);

  return lines.join("") || `<div class="om-diff-line om-diff-ins">${escapeHtml(replace.slice(0, 500))}</div>`;
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
