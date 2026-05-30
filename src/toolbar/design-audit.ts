// UX/UI review: derive the page's de-facto design system (its "brand guidelines")
// from runtime computed styles, then build a senior-designer review prompt that
// asks the model to find issues and propose fixes that stay CONSISTENT with that
// system. The summarize/format/prompt functions are pure + unit-tested; the DOM
// sampler (collectStyleSamples) lives at the bottom and runs in the browser.

export interface StyleSample {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  borderRadius?: string;
  boxShadow?: string;
}

export interface DesignTokens {
  colors: Array<{ value: string; count: number }>;
  backgrounds: Array<{ value: string; count: number }>;
  fontFamilies: string[];
  fontSizes: string[];
  fontWeights: string[];
  radii: string[];
  shadows: string[];
}

const EMPTY_COLOR = new Set(["", "transparent", "inherit", "initial", "currentcolor", "none", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)"]);

function rankByFrequency(values: Array<string | undefined>, limit = 8): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = (raw || "").trim().toLowerCase();
    if (EMPTY_COLOR.has(v)) continue;
    // preserve original casing of the first occurrence
    const key = (raw || "").trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function firstFamily(font: string | undefined): string {
  return (font || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function uniqueSortedPx(sizes: Array<string | undefined>): string[] {
  const set = new Set<string>();
  for (const s of sizes) { const v = (s || "").trim(); if (v) set.add(v); }
  return [...set].sort((a, b) => parseFloat(a) - parseFloat(b));
}

export function summarizeDesignTokens(samples: StyleSample[]): DesignTokens {
  const fontFamilies = [...new Set(samples.map((s) => firstFamily(s.fontFamily)).filter(Boolean))].slice(0, 6);
  const fontWeights = [...new Set(samples.map((s) => (s.fontWeight || "").trim()).filter(Boolean))]
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  const radii = [...new Set(samples.map((s) => (s.borderRadius || "").trim()).filter((v) => v && parseFloat(v) > 0))]
    .sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 8);
  const shadows = [...new Set(samples.map((s) => (s.boxShadow || "").trim()).filter((v) => v && v !== "none"))].slice(0, 6);

  return {
    colors: rankByFrequency(samples.map((s) => s.color)),
    backgrounds: rankByFrequency(samples.map((s) => s.backgroundColor)),
    fontFamilies,
    fontSizes: uniqueSortedPx(samples.map((s) => s.fontSize)),
    fontWeights,
    radii,
    shadows,
  };
}

export function formatDesignTokensForPrompt(tokens: DesignTokens): string {
  const lines: string[] = ["## Detected design system (the page's existing brand / UI conventions — keep proposals consistent with these)"];
  if (tokens.colors.length) lines.push(`Text colors (most → least used): ${tokens.colors.map((c) => c.value).join(", ")}`);
  if (tokens.backgrounds.length) lines.push(`Backgrounds: ${tokens.backgrounds.map((b) => b.value).join(", ")}`);
  if (tokens.fontFamilies.length) lines.push(`Fonts: ${tokens.fontFamilies.join(", ")}`);
  if (tokens.fontSizes.length) lines.push(`Type scale (sizes): ${tokens.fontSizes.join(", ")}`);
  if (tokens.fontWeights.length) lines.push(`Font weights: ${tokens.fontWeights.join(", ")}`);
  if (tokens.radii.length) lines.push(`Border radii: ${tokens.radii.join(", ")}`);
  if (tokens.shadows.length) lines.push(`Shadows: ${tokens.shadows.join(" | ")}`);
  return lines.join("\n");
}

export function buildDesignReviewPrompt(tokens: DesignTokens, opts: { pageTitle?: string } = {}): string {
  return [
    `Act as a senior product designer reviewing the UI/UX of this page${opts.pageTitle ? ` ("${opts.pageTitle}")` : ""}. A screenshot of the current page is attached.`,
    "",
    "Audit it across these dimensions and identify EVERY issue you can see:",
    "1. Visual hierarchy — is the most important content emphasized? heading sizes, weight, order",
    "2. Spacing & alignment — consistent rhythm, padding/margins, grid alignment, crowding",
    "3. Color & contrast — WCAG AA text contrast, sensible use of the palette, state colors",
    "4. Typography — readable sizes/line-height, a coherent type scale, not too many fonts",
    "5. Consistency — components, spacing, radii, and colors used consistently across the page",
    "6. Accessibility — contrast, focus states, hit targets, labels/alt text",
    "7. Responsiveness & layout — sensible widths, no overflow, balanced composition",
    "",
    "Then propose concrete fixes. If the page is broadly weak, propose a cohesive redesign; if it's mostly good, propose targeted fixes only.",
    "",
    formatDesignTokensForPrompt(tokens),
    "",
    "CRITICAL: your changes MUST stay consistent with the detected design system above and any project design tokens (CSS variables, Tailwind theme, theme files) you find in the grounded source — reuse existing tokens/classes rather than introducing new ad-hoc colors, fonts, or spacing. Prefer the project's styling approach.",
    "",
    "In the explanation, list the issues you found as a short bulleted summary. In modifications, return the code changes that implement your fixes (so they can be previewed and applied). Change real source files; keep edits minimal and idiomatic.",
  ].join("\n");
}

// ── Browser: sample computed styles across the visible page ──────────────────
// Excluded from unit tests (uses the DOM); the aggregation above is what's tested.
export function collectStyleSamples(maxElements = 400): StyleSample[] {
  if (typeof document === "undefined") return [];
  const samples: StyleSample[] = [];
  const all = document.body ? Array.from(document.body.querySelectorAll<HTMLElement>("*")) : [];
  for (const el of all) {
    if (samples.length >= maxElements) break;
    if (el.closest("openmagic-toolbar") || (el as any).dataset?.openmagic) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue; // skip invisible / zero-size
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    samples.push({
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
    });
  }
  return samples;
}
