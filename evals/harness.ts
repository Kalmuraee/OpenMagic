import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatchGroup, clearPatchManifests, type FilePatch } from "../src/patch.js";
import { groundProject } from "../src/project-grounding.js";

// A scenario replays a known LLM response (modifications) through the REAL
// grounding → patch pipeline against a copy of a fixture, and asserts the
// outcome. Deterministic and key-free, so it runs in CI and measures the
// grounding + apply fidelity that dominates edit-success-rate.
export interface Scenario {
  name: string;
  fixture: string;
  prompt?: string;
  selectedElement?: Record<string, unknown>;
  modifications?: Array<{
    file: string;
    type: "edit" | "create" | "delete";
    search?: string;
    replace?: string;
    content?: string;
  }>;
  expect?: {
    applies: boolean;
    file?: string;
    contains?: string[];
    notContains?: string[];
  };
  expectGrounding?: { includes: string[] };
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  reason: string;
}

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

function toFilePatch(mod: NonNullable<Scenario["modifications"]>[number]): FilePatch {
  if (mod.type === "create") return { type: "create", file: mod.file, content: mod.content || "" };
  if (mod.type === "delete") return { type: "delete", file: mod.file };
  return { type: "replace", file: mod.file, search: mod.search || "", replace: mod.replace || "" };
}

export function runScenario(scenario: Scenario): ScenarioResult {
  const fixtureSrc = join(FIXTURES_DIR, scenario.fixture);
  if (!existsSync(fixtureSrc)) {
    return { name: scenario.name, passed: false, reason: `fixture not found: ${scenario.fixture}` };
  }

  const root = mkdtempSync(join(tmpdir(), "om-eval-"));
  try {
    cpSync(fixtureSrc, root, { recursive: true });

    // Grounding-only scenario: assert the right files are surfaced.
    if (scenario.expectGrounding) {
      const grounded = groundProject(root, {
        pageUrl: scenario.prompt ? "http://localhost/" : "http://localhost/",
        promptText: scenario.prompt || "",
        selectedElement: scenario.selectedElement as any,
      });
      const paths = grounded.files.map((f) => f.path).concat(grounded.rankedFiles.map((f) => f.path));
      const missing = scenario.expectGrounding.includes.filter((want) => !paths.some((p) => p === want || p.endsWith(want)));
      return missing.length
        ? { name: scenario.name, passed: false, reason: `grounding missed: ${missing.join(", ")} (got: ${paths.slice(0, 6).join(", ")})` }
        : { name: scenario.name, passed: true, reason: "grounded expected files" };
    }

    // Apply scenario: replay modifications through the real patch pipeline.
    const patches = (scenario.modifications || []).map(toFilePatch);
    const result = applyPatchGroup(root, { patches });
    const exp = scenario.expect!;

    if (result.applied !== exp.applies) {
      const firstReason = result.changes.find((c) => !c.ok)?.reason || "";
      return { name: scenario.name, passed: false, reason: `expected applies=${exp.applies}, got ${result.applied} (${firstReason})` };
    }

    if (exp.file) {
      const target = join(root, exp.file);
      const content = existsSync(target) ? readFileSync(target, "utf-8") : "";
      for (const needle of exp.contains || []) {
        if (!content.includes(needle)) return { name: scenario.name, passed: false, reason: `expected ${exp.file} to contain ${JSON.stringify(needle)}` };
      }
      for (const needle of exp.notContains || []) {
        if (content.includes(needle)) return { name: scenario.name, passed: false, reason: `expected ${exp.file} to NOT contain ${JSON.stringify(needle)}` };
      }
    }

    return { name: scenario.name, passed: true, reason: "ok" };
  } finally {
    clearPatchManifests();
    rmSync(root, { recursive: true, force: true });
  }
}
