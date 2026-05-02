import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectFramework, groundProject } from "../src/project-grounding.js";

const ROOT = join(process.cwd(), ".test-grounding-root");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, "src/app/dashboard"), { recursive: true });
  mkdirSync(join(ROOT, "src/components"), { recursive: true });
  writeFileSync(join(ROOT, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }));
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
});
