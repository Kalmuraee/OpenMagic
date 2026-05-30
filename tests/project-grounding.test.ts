import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { detectFramework, detectRepoConventions, groundProject, routePathCandidates } from "../src/project-grounding.js";

function fixtureWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "om-fw-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const ROOT = join(process.cwd(), ".test-grounding-root");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "src/app/dashboard"), { recursive: true });
  mkdirSync(join(ROOT, "src/components"), { recursive: true });
  writeFileSync(join(ROOT, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }));
  writeFileSync(join(ROOT, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }));
  writeFileSync(join(ROOT, ".prettierrc"), "{\"semi\": true}\n");
  writeFileSync(join(ROOT, "src/theme.ts"), "export const theme = { color: 'purple' };\n");
  writeFileSync(join(ROOT, "src/app/dashboard/page.tsx"), "import { DashboardCard } from '../../components/DashboardCard';\nexport default function Page(){ return <DashboardCard />; }\n");
  writeFileSync(join(ROOT, "src/components/DashboardCard.tsx"), "import './DashboardCard.css';\nexport function DashboardCard(){ return <section className=\"dashboard-card\">Revenue</section>; }\n");
  writeFileSync(join(ROOT, "src/components/DashboardCard.css"), ".dashboard-card { color: red; }\n");
});

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("project grounding", () => {
  it("detects the framework", () => {
    expect(detectFramework(ROOT)).toBe("next");
  });

  it("detects the new frameworks (Phase 8 R3)", () => {
    const dep = (name: string) => JSON.stringify({ dependencies: { [name]: "1.0.0" } });
    expect(detectFramework(fixtureWith({ "package.json": dep("@angular/core") }))).toBe("angular");
    expect(detectFramework(fixtureWith({ "package.json": dep("@react-router/dev") }))).toBe("react-router");
    expect(detectFramework(fixtureWith({ "package.json": dep("@solidjs/start") }))).toBe("solidstart");
    expect(detectFramework(fixtureWith({ "package.json": JSON.stringify({ dependencies: { nuxt: "3.0.0" } }) }))).toBe("nuxt");
    expect(detectFramework(fixtureWith({ "package.json": dep("@sveltejs/kit") }))).toBe("sveltekit");
    // a plain react SPA that merely uses react-router-dom is NOT react-router framework mode
    expect(detectFramework(fixtureWith({ "package.json": JSON.stringify({ dependencies: { react: "19.0.0", "react-router-dom": "6.0.0" } }) }))).toBe("vite-react");
  });

  it("maps URL routes to source files per framework (Phase 8 R3)", () => {
    expect(routePathCandidates("http://x/dashboard", "nuxt")).toContain("app/pages/dashboard.vue");
    expect(routePathCandidates("http://x/dashboard", "nuxt")).toContain("pages/dashboard/index.vue");
    expect(routePathCandidates("http://x/about", "solidstart")).toContain("src/routes/about.tsx");
    expect(routePathCandidates("http://x/", "solidstart")).toContain("src/routes/index.tsx");
    expect(routePathCandidates("http://x/about", "react-router")).toContain("app/routes/about.tsx");
    expect(routePathCandidates("http://x/", "react-router")).toContain("app/routes/_index.tsx");
    expect(routePathCandidates("http://x/settings/profile", "react-router")).toContain("app/routes/settings.profile.tsx");
    expect(routePathCandidates("http://x/anything", "angular")).toContain("src/app/app.routes.ts");
    expect(routePathCandidates("http://x/blog", "sveltekit")).toContain("src/routes/blog/+page.svelte");
  });

  it("summarizes repo conventions (H15)", () => {
    const conventions = detectRepoConventions(ROOT);
    expect(conventions).toContain("Framework: next");
    expect(conventions).toContain("Components live in: src/components/");
    expect(conventions).toContain("TypeScript:");
    // also surfaced on the ground result
    const result = groundProject(ROOT, { pageUrl: "http://localhost/dashboard", promptText: "dashboard" });
    expect(result.conventions).toContain("Framework: next");
  });

  it("marks truncated files instead of silently slicing them (H10)", () => {
    const big = "export const data = '" + "x".repeat(20000) + "';\n// dashboard card marker\n";
    writeFileSync(join(ROOT, "src/components/DashboardCard.tsx"), big);

    const result = groundProject(ROOT, {
      pageUrl: "http://localhost:4567/dashboard",
      promptText: "make dashboard card responsive",
      selectedElement: { componentHint: "DashboardCard", className: "dashboard-card" },
      contextBudget: 100000,
    });

    const card = result.files.find((f) => f.path === "src/components/DashboardCard.tsx");
    expect(card?.truncated).toBe(true);
    expect(card?.content).toContain("[TRUNCATED");
    expect(card?.content).toContain("NEED_FILE: src/components/DashboardCard.tsx");
  });

  it("grounds route, component, import, and CSS files with reasons", () => {
    const result = groundProject(ROOT, {
      pageUrl: "http://localhost:4567/dashboard",
      promptText: "make dashboard card responsive",
      selectedElement: { componentHint: "DashboardCard", className: "dashboard-card" },
    });

    expect(result.framework).toBe("next");
    expect(result.files.map((file) => file.path)).toContain("src/app/dashboard/page.tsx");
    expect(result.files.map((file) => file.path)).toContain("src/components/DashboardCard.tsx");
    expect(result.files.map((file) => file.path)).toContain("src/components/DashboardCard.css");
    expect(result.rankedFiles.find((file) => file.path === "src/app/dashboard/page.tsx")?.reasons).toContain("route match");
    expect(result.rankedFiles.find((file) => file.path === "src/components/DashboardCard.tsx")?.reasons).toContain("selected component");
  });

  it("respects the context budget", () => {
    const result = groundProject(ROOT, {
      pageUrl: "http://localhost:4567/dashboard",
      promptText: "dashboard",
      contextBudget: 100,
    });

    const total = result.files.reduce((sum, file) => sum + file.content.length, 0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it("grounds tsconfig aliases and dotfile/theme config candidates", () => {
    writeFileSync(join(ROOT, "src/app/dashboard/page.tsx"), "import { DashboardCard } from '@/components/DashboardCard';\nexport default function Page(){ return <DashboardCard />; }\n");

    const result = groundProject(ROOT, {
      pageUrl: "http://localhost:4567/dashboard",
      promptText: "use the theme for dashboard",
      selectedElement: { className: "dashboard-card" },
    });

    const paths = result.files.map((file) => file.path);
    expect(paths).toContain("src/components/DashboardCard.tsx");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain(".prettierrc");
    expect(paths).toContain("src/theme.ts");
  });
});
