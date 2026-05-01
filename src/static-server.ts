import { extname, relative, resolve } from "node:path";

export const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function resolveStaticRequestPath(rootDir: string, requestUrl: string | undefined): string | null {
  let pathname: string;
  try {
    const rawPath = (requestUrl || "/").split(/[?#]/, 1)[0];
    const decodedRawPath = decodeURIComponent(rawPath);
    if (decodedRawPath.split(/[\\/]+/).includes("..")) return null;

    pathname = new URL(requestUrl || "/", "http://localhost").pathname;
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (pathname === "/") pathname = "/index.html";
  const root = resolve(rootDir);
  const candidate = resolve(root, `.${pathname}`);
  const rel = relative(root, candidate);

  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    rel.startsWith("/") ||
    rel.startsWith("\\")
  ) {
    return null;
  }

  return candidate;
}

export function getStaticMimeType(filePath: string): string {
  return STATIC_MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}
