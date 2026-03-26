export interface SelectedElement {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  outerHTML: string;
  cssSelector: string;
  xpath: string;
  computedStyles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
}

const IMPORTANT_STYLES = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "background-color",
  "background",
  "font-size",
  "font-weight",
  "font-family",
  "border",
  "border-radius",
  "box-shadow",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "overflow",
  "opacity",
  "z-index",
  "text-align",
  "line-height",
  "letter-spacing",
];

export function inspectElement(el: HTMLElement): SelectedElement {
  const computed = window.getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of IMPORTANT_STYLES) {
    styles[prop] = computed.getPropertyValue(prop);
  }

  const rect = el.getBoundingClientRect();

  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || "",
    className: el.className || "",
    textContent: (el.textContent || "").trim().slice(0, 200),
    outerHTML: getCleanOuterHTML(el),
    cssSelector: getCssSelector(el),
    xpath: getXPath(el),
    computedStyles: styles,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

function getCleanOuterHTML(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;

  // Remove script tags and large content
  const scripts = clone.querySelectorAll("script, style, svg");
  scripts.forEach((s) => s.remove());

  // Truncate children if too many
  let html = clone.outerHTML;
  if (html.length > 2000) {
    // Just get the opening tag + first level children hints
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes)
      .map((a) => `${a.name}="${a.value}"`)
      .join(" ");
    const childSummary = Array.from(el.children)
      .slice(0, 5)
      .map((c) => `<${c.tagName.toLowerCase()} .../>`)
      .join("\n  ");
    html = `<${tag} ${attrs}>\n  ${childSummary}\n  ${el.children.length > 5 ? `<!-- +${el.children.length - 5} more children -->` : ""}\n</${tag}>`;
  }

  return html;
}

function getCssSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts: string[] = [];
  let current: HTMLElement | null = el;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    if (current.className && typeof current.className === "string") {
      const classes = current.className
        .trim()
        .split(/\s+/)
        .filter((c) => !c.startsWith("__") && c.length < 30)
        .slice(0, 2)
        .map((c) => CSS.escape(c));
      if (classes.length > 0) {
        selector += "." + classes.join(".");
      }
    }

    // Add nth-of-type if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function getXPath(el: HTMLElement): string {
  const parts: string[] = [];
  let current: Node | null = el;

  while (current && current !== document) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      let index = 1;
      let sibling = element.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === element.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${element.tagName.toLowerCase()}[${index}]`);
    }
    current = current.parentNode;
  }

  return "/" + parts.join("/");
}

// --- Highlight Overlay ---

let highlightEl: HTMLDivElement | null = null;

export function showHighlight(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  if (!highlightEl) {
    highlightEl = document.createElement("div");
    highlightEl.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483646;
      border: 2px solid #6c5ce7;
      background: rgba(108, 92, 231, 0.1);
      transition: all 0.1s ease;
    `;
    highlightEl.dataset.openmagic = "highlight";
    document.body.appendChild(highlightEl);
  }

  highlightEl.style.left = `${rect.x}px`;
  highlightEl.style.top = `${rect.y}px`;
  highlightEl.style.width = `${rect.width}px`;
  highlightEl.style.height = `${rect.height}px`;
  highlightEl.style.display = "block";
}

export function hideHighlight(): void {
  if (highlightEl) {
    highlightEl.style.display = "none";
  }
}

export function removeHighlight(): void {
  if (highlightEl) {
    highlightEl.remove();
    highlightEl = null;
  }
}
