export interface SelectedElement {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  outerHTML: string;
  cssSelector: string;
  xpath: string;
  computedStyles: Record<string, string>;
  ancestry: string[];
  componentHint: string;
  rect: { x: number; y: number; width: number; height: number };
  // Enhanced context
  parentStyles: Record<string, string>;
  siblings: string[];
  matchedCssRules: string[];
  viewport: { width: number; height: number };
  ariaAttributes: Record<string, string>;
  eventHandlers: string[];
  reactProps: Record<string, unknown> | null;
  childrenLayout: {
    tag: string;
    className: string;
    rect: { x: number; y: number; width: number; height: number };
    gapToNext: { horizontal: number; vertical: number } | null;
    margin: string;
    padding: string;
  }[];
  resolvedClasses: { className: string; css: string }[];
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

  // Parent container styles (critical for layout context)
  const parentStyles: Record<string, string> = {};
  if (el.parentElement && el.parentElement !== document.body) {
    const parentComputed = window.getComputedStyle(el.parentElement);
    for (const prop of IMPORTANT_STYLES) {
      parentStyles[prop] = parentComputed.getPropertyValue(prop);
    }
  }

  // Sibling elements (layout context — ±3 siblings around the selected element)
  const siblings: string[] = [];
  if (el.parentElement) {
    const children = Array.from(el.parentElement.children);
    const selectedIdx = children.indexOf(el);
    const start = Math.max(0, selectedIdx - 3);
    const end = Math.min(children.length, selectedIdx + 4);
    if (start > 0) siblings.push(`... ${start} elements before ...`);
    for (let i = start; i < end; i++) {
      const sib = children[i];
      const tag = sib.tagName.toLowerCase();
      const cls = (sib.className || "").toString().slice(0, 60);
      if (sib === el) {
        siblings.push(`[SELECTED] <${tag} class="${cls}">`);
      } else {
        siblings.push(`<${tag} class="${cls}">`);
      }
    }
    if (end < children.length) siblings.push(`... ${children.length - end} elements after ...`);
  }

  // Children layout measurements (pixel-level spacing context)
  const childrenLayout: SelectedElement["childrenLayout"] = [];
  const directChildren = Array.from(el.children).slice(0, 12);
  for (let i = 0; i < directChildren.length; i++) {
    const child = directChildren[i] as HTMLElement;
    const cRect = child.getBoundingClientRect();
    const cComputed = window.getComputedStyle(child);
    let gapToNext: { horizontal: number; vertical: number } | null = null;
    if (i < directChildren.length - 1) {
      const nextRect = (directChildren[i + 1] as HTMLElement).getBoundingClientRect();
      gapToNext = {
        vertical: Math.round(nextRect.top - cRect.bottom),
        horizontal: Math.round(nextRect.left - cRect.right),
      };
    }
    childrenLayout.push({
      tag: child.tagName.toLowerCase(),
      className: (child.className || "").toString().slice(0, 80),
      rect: { x: Math.round(cRect.x), y: Math.round(cRect.y), width: Math.round(cRect.width), height: Math.round(cRect.height) },
      gapToNext,
      margin: cComputed.margin,
      padding: cComputed.padding,
    });
  }

  // Matched CSS rules from stylesheets
  const matchedCssRules = getMatchedCssRules(el);

  // Resolve Tailwind/utility classes to their CSS values
  const resolvedClasses = resolveClasses(el, matchedCssRules);

  // ARIA / accessibility attributes
  const ariaAttributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("aria-") || attr.name === "role" || attr.name === "tabindex") {
      ariaAttributes[attr.name] = attr.value;
    }
  }

  // Event handlers (from element attributes and React props)
  const eventHandlers: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("on")) eventHandlers.push(attr.name);
  }

  // React props extraction
  const reactProps = getReactProps(el);

  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || "",
    className: el.className || "",
    textContent: (el.textContent || "").trim().slice(0, 200),
    outerHTML: getCleanOuterHTML(el),
    cssSelector: getCssSelector(el),
    xpath: getXPath(el),
    computedStyles: styles,
    ancestry: getAncestry(el),
    componentHint: getComponentHint(el),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    parentStyles,
    siblings,
    childrenLayout,
    matchedCssRules,
    resolvedClasses,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    ariaAttributes,
    eventHandlers,
    reactProps,
  };
}

function getAncestry(el: HTMLElement, depth: number = 5): string[] {
  const result: string[] = [];
  let current = el.parentElement;
  while (current && current !== document.body && result.length < depth) {
    const tag = current.tagName.toLowerCase();
    const cls = (typeof current.className === "string" ? current.className : "")
      .split(/\s+/).filter(c => c.length > 1 && !c.startsWith("_")).slice(0, 3).join(".");
    result.push(cls ? `${tag}.${cls}` : tag);
    current = current.parentElement;
  }
  return result;
}

function getComponentHint(el: HTMLElement): string {
  // Try to find component name from data attributes or React fiber
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    // Check common framework data attributes
    const dataComponent = current.getAttribute("data-component")
      || current.getAttribute("data-testid")
      || current.getAttribute("data-cy");
    if (dataComponent) return dataComponent;

    // React: check __reactFiber or __reactInternalInstance
    const keys = Object.keys(current);
    for (const key of keys) {
      if (key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")) {
        try {
          const fiber = (current as any)[key];
          const name = fiber?.type?.name || fiber?.type?.displayName
            || fiber?.return?.type?.name || fiber?.return?.type?.displayName;
          if (name && name !== "div" && name !== "span" && name.length > 1) return name;
        } catch {}
      }
    }

    current = current.parentElement;
  }
  return "";
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

// --- Matched CSS Rules ---

function getMatchedCssRules(el: HTMLElement): string[] {
  const rules: string[] = [];
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const cssRules = sheet.cssRules || sheet.rules;
        if (!cssRules) continue;
        for (const rule of Array.from(cssRules)) {
          if (rule instanceof CSSStyleRule) {
            try {
              if (el.matches(rule.selectorText)) {
                // Only include rules with meaningful styles (skip resets/normalizers)
                const text = rule.cssText;
                if (text.length > 10 && text.length < 500) {
                  rules.push(text);
                }
              }
            } catch { /* invalid selector */ }
          }
        }
      } catch { /* cross-origin stylesheet */ }
    }
  } catch { /* stylesheet access error */ }
  return rules.slice(0, 15); // Cap at 15 rules
}

// --- React Props Extraction ---

function getReactProps(el: HTMLElement): Record<string, unknown> | null {
  try {
    const keys = Object.keys(el);
    for (const key of keys) {
      if (key.startsWith("__reactFiber") || key.startsWith("__reactInternalInstance")) {
        const fiber = (el as any)[key];
        if (!fiber?.memoizedProps) continue;
        const props = fiber.memoizedProps;
        // Extract safe, serializable props (skip functions, React elements, large objects)
        const safe: Record<string, unknown> = {};
        let count = 0;
        for (const [k, v] of Object.entries(props)) {
          if (count >= 10) break;
          if (k === "children") continue; // Skip children (too large)
          const t = typeof v;
          if (t === "string" || t === "number" || t === "boolean" || v === null) {
            safe[k] = v;
            count++;
          } else if (t === "function") {
            safe[k] = "[function]";
            count++;
          } else if (Array.isArray(v)) {
            safe[k] = `[Array(${v.length})]`;
            count++;
          }
        }
        return Object.keys(safe).length > 0 ? safe : null;
      }
    }
  } catch { /* not React or access error */ }
  return null;
}

// --- Tailwind / Utility Class Resolution ---

function resolveClasses(el: HTMLElement, matchedRules: string[]): { className: string; css: string }[] {
  const resolved: { className: string; css: string }[] = [];
  const classes = (el.className || "").toString().trim().split(/\s+/).filter(Boolean);

  for (const cls of classes) {
    const escaped = CSS.escape(cls);
    for (const rule of matchedRules) {
      if (rule.includes(`.${escaped}`) && rule.length < 200) {
        resolved.push({ className: cls, css: rule });
        break;
      }
    }
    if (resolved.length >= 20) break;
  }
  return resolved;
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

