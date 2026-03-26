// Simple screenshot capture using Canvas API
// Falls back to a simpler approach if html-to-image isn't available

export async function captureScreenshot(
  target?: HTMLElement
): Promise<string | null> {
  try {
    // Try using the Canvas approach for element capture
    if (target) {
      return await captureElementViaCanvas(target);
    }

    // Full page: use a simple canvas capture of the viewport
    return await captureViewport();
  } catch (e) {
    console.warn("[OpenMagic] Screenshot capture failed:", e);
    return null;
  }
}

async function captureViewport(): Promise<string | null> {
  // Create a canvas the size of the viewport
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // We can't directly capture the viewport without html2canvas or similar
  // Instead, we use the SVG foreignObject approach (snapdom-like)
  try {
    const svgData = await elementToSvg(document.body);
    const img = await svgToImage(svgData, window.innerWidth, window.innerHeight);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function captureElementViaCanvas(
  element: HTMLElement
): Promise<string | null> {
  const rect = element.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  try {
    const svgData = await elementToSvg(element);
    const img = await svgToImage(svgData, rect.width, rect.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function elementToSvg(element: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    const clone = element.cloneNode(true) as HTMLElement;

    // Inline computed styles on the clone
    inlineStyles(element, clone);

    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const foreignObject = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">
            ${clone.outerHTML}
          </div>
        </foreignObject>
      </svg>`;

    resolve(foreignObject);
  });
}

function inlineStyles(source: HTMLElement, target: HTMLElement): void {
  const computed = window.getComputedStyle(source);
  let cssText = "";
  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    cssText += `${prop}:${computed.getPropertyValue(prop)};`;
  }
  target.style.cssText = cssText;

  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length && i < targetChildren.length; i++) {
    inlineStyles(
      sourceChildren[i] as HTMLElement,
      targetChildren[i] as HTMLElement
    );
  }
}

function svgToImage(
  svgData: string,
  width: number,
  height: number
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG image"));
    };

    img.width = width;
    img.height = height;
    img.src = url;
  });
}
