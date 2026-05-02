import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { listFiles, readFileSafe } from "./filesystem.js";

export interface ProjectGroundRequest {
  pageUrl?: string;
  promptText?: string;
  selectedElement?: {
    id?: string;
    className?: string;
    textContent?: string;
    tagName?: string;
    componentHint?: string;
    ancestry?: string[];
  };
  contextBudget?: number;
}

export interface GroundedFile {
  path: string;
  content: string;
  reasons: string[];
  score: number;
}

export interface ProjectGroundResult {
  framework: string;
  files: GroundedFile[];
  rankedFiles: Array<{
    path: string;
    reasons: string[];
    score: number;
    snippet: string;
  }>;
}

const TEXT_RE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro|html?|css|scss|less|php|py|rb|blade\.php)$/i;
const STOP_WORDS = new Set(["the", "to", "in", "of", "and", "div", "span", "class", "style", "with", "for", "from"]);
const DEFAULT_BUDGET = 48_000;
const MAX_FILES = 10;

export function groundProject(root: string, request: ProjectGroundRequest): ProjectGroundResult {
  const framework = detectFramework(root);
  const files = listFiles(root, [root], 8).filter((file) => file.type === "file" && TEXT_RE.test(file.path));
  const tokens = buildTokens(request);
  const routePaths = routePathCandidates(request.pageUrl || "", framework);
  const scored = scoreFiles(files.map((file) => file.path), tokens, routePaths, request, framework);
  const selected = new Map<string, { score: number; reasons: Set<string> }>();

  for (const item of scored.slice(0, MAX_FILES)) {
    if (item.score <= 0) continue;
    selected.set(item.path, { score: item.score, reasons: new Set(item.reasons) });
  }

  for (const routePath of routePaths) {
    if (files.some((file) => file.path === routePath)) {
      mergeSelection(selected, routePath, 30, "route match");
    }
  }

  for (const item of [...selected.keys()].slice(0, 4)) {
    for (const dep of localImportCandidates(root, item, files.map((file) => file.path))) {
      mergeSelection(selected, dep, 8, "import dependency");
    }
    for (const style of styleCandidates(item, files.map((file) => file.path))) {
      mergeSelection(selected, style, 6, "CSS match");
    }
  }

  for (const config of configCandidates(framework)) {
    if (files.some((file) => file.path === config)) {
      mergeSelection(selected, config, 4, "framework config");
    }
  }

  const budget = Math.max(1, request.contextBudget || DEFAULT_BUDGET);
  let used = 0;
  const grounded: GroundedFile[] = [];
  const ranked = [...selected.entries()]
    .map(([path, value]) => ({ path, score: value.score, reasons: [...value.reasons] }))
    .sort((a, b) => b.score - a.score);

  for (const item of ranked) {
    if (grounded.length >= MAX_FILES || used >= budget) break;
    const read = readFileSafe(join(root, item.path), [root]);
    if ("error" in read) continue;
    const cap = Math.min(12_000, budget - used);
    if (cap <= 0) break;
    const content = read.content.slice(0, cap);
    grounded.push({ path: item.path, content, reasons: item.reasons, score: item.score });
    used += content.length;
  }

  return {
    framework,
    files: grounded,
    rankedFiles: grounded.map((file) => ({
      path: file.path,
      reasons: file.reasons,
      score: file.score,
      snippet: file.content.slice(0, 400),
    })),
  };
}

export function detectFramework(root: string): string {
  const pkgPath = join(root, "package.json");
  let deps: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch {}
  }

  if (deps.next || existsSync(join(root, "next.config.js")) || existsSync(join(root, "next.config.mjs"))) return "next";
  if (deps["@sveltejs/kit"] || existsSync(join(root, "svelte.config.js"))) return "sveltekit";
  if (deps.astro || existsSync(join(root, "astro.config.mjs"))) return "astro";
  if (deps.nuxt || existsSync(join(root, "nuxt.config.ts"))) return "nuxt";
  if (deps.vue || existsSync(join(root, "vite.config.ts"))) return deps.react ? "vite-react" : "vue";
  if (deps.react || existsSync(join(root, "src/App.tsx")) || existsSync(join(root, "src/App.jsx"))) return "vite-react";
  if (existsSync(join(root, "config/routes.rb"))) return "rails";
  if (existsSync(join(root, "manage.py"))) return "django";
  if (existsSync(join(root, "artisan"))) return "laravel";
  return "unknown";
}

function buildTokens(request: ProjectGroundRequest): string[] {
  const sources = [
    request.promptText || "",
    request.selectedElement?.id || "",
    request.selectedElement?.className || "",
    request.selectedElement?.textContent || "",
    request.selectedElement?.componentHint || "",
    ...(request.selectedElement?.ancestry || []),
  ];
  return sources.join(" ").toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function routePathCandidates(pageUrl: string, framework: string): string[] {
  let pathname = "/";
  try {
    pathname = new URL(pageUrl || "http://localhost/").pathname;
  } catch {}
  const clean = pathname.replace(/^\/+|\/+$/g, "");
  const route = clean || "index";
  const parts = clean ? clean.split("/") : [];
  const candidates: string[] = [];

  if (framework === "next") {
    const appRoute = clean ? `${clean}/page` : "page";
    candidates.push(
      `src/app/${appRoute}.tsx`,
      `src/app/${appRoute}.ts`,
      `app/${appRoute}.tsx`,
      `app/${appRoute}.ts`,
      `src/pages/${route}.tsx`,
      `src/pages/${route}.ts`,
      `pages/${route}.tsx`,
      `pages/${route}.ts`
    );
  } else if (framework === "sveltekit") {
    candidates.push(`src/routes/${clean}/+page.svelte`, "src/routes/+page.svelte");
  } else if (framework === "astro") {
    candidates.push(`src/pages/${route}.astro`, "src/pages/index.astro");
  } else {
    candidates.push("src/App.tsx", "src/App.jsx", "src/main.tsx", "src/main.jsx", `src/pages/${route}.tsx`);
  }

  for (const part of parts) {
    candidates.push(`src/components/${capitalize(part)}.tsx`, `src/${part}.tsx`);
  }
  return [...new Set(candidates)];
}

function scoreFiles(
  paths: string[],
  tokens: string[],
  routePaths: string[],
  request: ProjectGroundRequest,
  framework: string
): Array<{ path: string; score: number; reasons: string[] }> {
  return paths.map((path) => {
    const lower = path.toLowerCase();
    const reasons = new Set<string>();
    let score = 0;

    if (routePaths.includes(path)) {
      score += 30;
      reasons.add("route match");
    }

    const componentHint = request.selectedElement?.componentHint?.toLowerCase();
    if (componentHint && lower.includes(componentHint)) {
      score += 16;
      reasons.add("selected component");
    }

    for (const token of tokens) {
      if (lower.includes(token)) {
        score += 4;
        reasons.add("search match");
      }
    }

    if (framework === "next" && /\/(page|layout)\.[jt]sx?$/.test(lower)) {
      score += 6;
      reasons.add("framework route file");
    } else if (framework === "vite-react" && /src\/(app|main)\.[jt]sx?$/.test(lower)) {
      score += 6;
      reasons.add("framework entry");
    }

    if (/(component|page|route|layout|template|view)/.test(lower)) score += 2;
    return { path, score, reasons: [...reasons] };
  }).sort((a, b) => b.score - a.score);
}

function localImportCandidates(root: string, file: string, allPaths: string[]): string[] {
  const read = readFileSafe(join(root, file), [root]);
  if ("error" in read) return [];
  const dir = dirname(file);
  const imports = [...read.content.matchAll(/(?:import|from)\s+["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]);
  const candidates: string[] = [];
  for (const imp of imports) {
    const base = relative(root, join(root, dir, imp));
    candidates.push(base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`);
  }
  return candidates.filter((candidate) => allPaths.includes(candidate));
}

function styleCandidates(file: string, allPaths: string[]): string[] {
  const base = file.replace(/\.[^.]+$/, "");
  const candidates = [`${base}.module.css`, `${base}.module.scss`, `${base}.css`, `${base}.scss`];
  return candidates.filter((candidate) => allPaths.includes(candidate));
}

function configCandidates(framework: string): string[] {
  const common = ["package.json", "tsconfig.json", "tailwind.config.ts", "tailwind.config.js", "src/index.css", "src/app/globals.css"];
  if (framework === "next") return [...common, "next.config.js", "next.config.mjs", "next.config.ts"];
  if (framework === "vite-react") return [...common, "vite.config.ts", "vite.config.js"];
  if (framework === "sveltekit") return [...common, "svelte.config.js", "vite.config.ts"];
  return common;
}

function mergeSelection(selected: Map<string, { score: number; reasons: Set<string> }>, path: string, score: number, reason: string): void {
  const existing = selected.get(path);
  if (existing) {
    existing.score += score;
    existing.reasons.add(reason);
  } else {
    selected.set(path, { score, reasons: new Set([reason]) });
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
