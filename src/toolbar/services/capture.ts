// Screenshot capture with multiple approaches and error feedback

export async function captureScreenshot(
  target?: HTMLElement
): Promise<string | null> {
  // Approach 1: Try the simple SVG foreignObject approach
  try {
    const el = target || document.body;
    const result = await captureViaSvg(el);
    if (result) return result;
  } catch (e) {
    console.warn("[OpenMagic] SVG screenshot failed:", e);
  }

  // Approach 2: Try capturing just the visible area as a simple canvas
  try {
    const result = await captureSimple(target);
    if (result) return result;
  } catch (e) {
    console.warn("[OpenMagic] Simple screenshot failed:", e);
  }

  console.warn("[OpenMagic] All screenshot methods failed");
  return null;
}

// Error feedback version — returns error message if failed
export async function captureScreenshotWithFeedback(
  target?: HTMLElement
): Promise<{ data: string | null; error?: string }> {
  try {
    const el = target || document.body;
    const result = await captureViaSvg(el);
    if (result) return { data: result };
  } catch (e: any) {
    // Fall through to simple
  }

  try {
    const result = await captureSimple(target);
    if (result) return { data: result };
  } catch (e: any) {
    return { data: null, error: `Screenshot failed: ${e.message || "unknown error"}. Try using the image attachment button instead.` };
  }

  return { data: null, error: "Screenshot capture not available on this page. Try pasting or dragging an image instead." };
}

async function captureViaSvg(element: HTMLElement): Promise<string | null> {
  const rect = element.getBoundingClientRect();
  const width = Math.min(rect.width || window.innerWidth, 1920);
  const height = Math.min(rect.height || window.innerHeight, 1080);

  // Clone and inline styles — but limit depth to avoid huge SVGs
  const clone = cloneWithStyles(element, 0, 4);
  if (!clone) return null;

  const svgData = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>`;

  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise<string | null>((resolve) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    img.onload = () => {
      URL.revokeObjectURL(url);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0);
      try {
        // Compress: resize to max 1280px wide, JPEG 80% quality
        const MAX_W = 1280;
        if (canvas.width > MAX_W) {
          const ratio = MAX_W / canvas.width;
          const small = document.createElement("canvas");
          small.width = MAX_W;
          small.height = Math.round(canvas.height * ratio);
          const sCtx = small.getContext("2d");
          if (sCtx) {
            sCtx.drawImage(canvas, 0, 0, small.width, small.height);
            resolve(small.toDataURL("image/jpeg", 0.8));
            return;
          }
        }
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      } catch {
        resolve(null); // Tainted canvas
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    // 5 second timeout
    setTimeout(() => { URL.revokeObjectURL(url); resolve(null); }, 5000);
    img.src = url;
  });
}

// Simpler approach: capture just text/layout info as a basic representation
async function captureSimple(target?: HTMLElement): Promise<string | null> {
  // Create a simple text-based capture showing element hierarchy
  // This works as fallback when SVG approach fails
  const el = target || document.documentElement;
  const rect = el.getBoundingClientRect();

  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Dark background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, 400, 300);

  // Draw element info
  ctx.fillStyle = "#e0e0e0";
  ctx.font = "14px system-ui";
  ctx.fillText(`Element: <${el.tagName.toLowerCase()}>`, 20, 30);
  ctx.fillStyle = "#888";
  ctx.font = "12px system-ui";
  ctx.fillText(`Size: ${Math.round(rect.width)}x${Math.round(rect.height)}`, 20, 55);
  ctx.fillText(`Classes: ${(el.className || "").toString().slice(0, 40)}`, 20, 75);
  ctx.fillText(`Page: ${window.location.pathname}`, 20, 95);
  ctx.fillStyle = "#6c5ce7";
  ctx.font = "11px system-ui";
  ctx.fillText("(Full screenshot unavailable — context sent as metadata)", 20, 130);

  return canvas.toDataURL("image/jpeg", 0.8);
}

function cloneWithStyles(source: HTMLElement, depth: number, maxDepth: number): HTMLElement | null {
  if (depth > maxDepth) return null;

  try {
    const clone = source.cloneNode(false) as HTMLElement;

    // Remove problematic elements
    if (clone.tagName === "SCRIPT" || clone.tagName === "STYLE" || clone.tagName === "SVG" ||
        clone.tagName === "CANVAS" || clone.tagName === "VIDEO" || clone.tagName === "IFRAME") {
      return null;
    }

    // Inline key styles only (not all — reduces size)
    const computed = window.getComputedStyle(source);
    const keyProps = ["display", "position", "width", "height", "margin", "padding",
      "color", "background-color", "background", "font-size", "font-weight", "font-family",
      "border", "border-radius", "flex-direction", "justify-content", "align-items", "gap",
      "grid-template-columns", "text-align", "overflow"];
    let css = "";
    for (const p of keyProps) {
      const v = computed.getPropertyValue(p);
      if (v && v !== "normal" && v !== "none" && v !== "auto" && v !== "0px") {
        css += `${p}:${v};`;
      }
    }
    clone.setAttribute("style", css);

    // Clone children with depth limit
    for (let i = 0; i < source.children.length && i < 20; i++) {
      const child = cloneWithStyles(source.children[i] as HTMLElement, depth + 1, maxDepth);
      if (child) clone.appendChild(child);
    }

    return clone;
  } catch {
    return null;
  }
}
