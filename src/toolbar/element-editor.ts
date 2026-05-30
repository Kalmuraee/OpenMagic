// Visual element editor: capture a selected element's editable properties, diff
// the user's live edits, and turn them into an instruction for the LLM to make
// the equivalent change in source. The pure functions here (diff/describe/
// serialize) are unit-tested; the DOM read/apply/revert glue lives in index.ts.

export interface ElementState {
  styles: Record<string, string>; // editable CSS prop → value
  text: string;                    // textContent
  className: string;
  attributes: Record<string, string>;
}

export interface PropChange {
  kind: "style" | "text" | "class" | "attribute";
  name: string; // CSS prop / attribute name; "" for text and class
  from: string;
  to: string;
}

// Curated set of commonly-edited CSS properties shown in the editor (pre-filled
// from computed styles). A free-form "custom CSS" field covers anything else.
export const EDITABLE_STYLE_PROPS: string[] = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "padding",
  "margin",
  "width",
  "height",
  "display",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "gap",
];

export function diffElementState(before: ElementState, after: ElementState): PropChange[] {
  const changes: PropChange[] = [];

  const styleKeys = new Set([...Object.keys(before.styles), ...Object.keys(after.styles)]);
  for (const name of styleKeys) {
    const from = before.styles[name] ?? "";
    const to = after.styles[name] ?? "";
    if (from !== to) changes.push({ kind: "style", name, from, to });
  }

  if (before.text !== after.text) changes.push({ kind: "text", name: "", from: before.text, to: after.text });
  if (before.className !== after.className) changes.push({ kind: "class", name: "", from: before.className, to: after.className });

  const attrKeys = new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)]);
  for (const name of attrKeys) {
    const from = before.attributes[name] ?? "";
    const to = after.attributes[name] ?? "";
    if (from !== to) changes.push({ kind: "attribute", name, from, to });
  }

  return changes;
}

/** Inline CSS declaration string from the style changes — used for live preview
 *  and as a deterministic fallback. */
export function changesToCssText(changes: PropChange[]): string {
  return changes
    .filter((c) => c.kind === "style" && c.to)
    .map((c) => `${c.name}: ${c.to};`)
    .join(" ");
}

/** A focused instruction telling the LLM to apply the user's visual edits in
 *  source, preferring the project's styling approach over inline styles. */
export function describeElementChanges(label: string, changes: PropChange[]): string {
  const lines = changes.map((c) => {
    switch (c.kind) {
      case "style": return `- CSS ${c.name}: ${c.from || "(unset)"} → ${c.to || "(removed)"}`;
      case "text": return `- text: "${c.from}" → "${c.to}"`;
      case "class": return `- class: "${c.from}" → "${c.to}"`;
      case "attribute": return `- attribute ${c.name}: "${c.from}" → "${c.to}"`;
    }
  });
  return (
    `I visually edited the \`${label}\` element in the running app. ` +
    `Make the equivalent change in the source code:\n\n${lines.join("\n")}\n\n` +
    `Use the project's styling approach (Tailwind classes, the existing CSS module/stylesheet, ` +
    `or styled-components) rather than adding inline styles, unless the file already uses inline styles. ` +
    `Change only what's needed.`
  );
}
