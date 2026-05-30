// U4: ⌘K command palette. Pure filtering/ranking logic (the UI lives in index.ts).

export interface Command {
  id: string;
  label: string;
  action: string;       // maps to a data-action handler
  keywords?: string[];
  detail?: string;
}

function subsequenceScore(haystack: string, needle: string): number {
  // Returns a score if every char of needle appears in order in haystack, else -1.
  let h = 0;
  let gaps = 0;
  for (const ch of needle) {
    const next = haystack.indexOf(ch, h);
    if (next === -1) return -1;
    gaps += next - h;
    h = next + 1;
  }
  return 100 - gaps; // fewer gaps = tighter match = higher score
}

/**
 * Rank commands against a query. Empty query → all, in original order.
 * Ranking (high→low): label prefix > label substring > keyword match >
 * fuzzy subsequence. No match → excluded.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];

  const scored: Array<{ cmd: Command; score: number; order: number }> = [];
  commands.forEach((cmd, order) => {
    const label = cmd.label.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 1000;
    else if (label.includes(q)) score = 800 - label.indexOf(q);
    else if ((cmd.keywords || []).some((k) => k.toLowerCase().includes(q))) score = 500;
    else {
      const sub = subsequenceScore(label, q);
      if (sub >= 0) score = 200 + sub;
    }
    if (score >= 0) scored.push({ cmd, score, order });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.cmd);
}
