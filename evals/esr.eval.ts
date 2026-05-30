import { afterAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runScenario, type Scenario, type ScenarioResult } from "./harness.js";

const SCENARIOS_DIR = join(import.meta.dirname, "scenarios");

function loadScenarios(): Scenario[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SCENARIOS_DIR, f), "utf-8")) as Scenario);
}

const scenarios = loadScenarios();
const results: ScenarioResult[] = [];

describe("OpenMagic edit-success-rate (ESR)", () => {
  it("has a non-empty scenario set", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runScenario(scenario);
      results.push(result);
      expect(result.passed, result.reason).toBe(true);
    });
  }

  afterAll(() => {
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    const esr = total ? Math.round((passed / total) * 100) : 0;
    // process.stdout.write (not console.log) so vitest doesn't intercept it —
    // vitest's own pass/fail count is the regression gate; this is the headline.
    const lines = [`\n  ── Edit-Success-Rate: ${passed}/${total} (${esr}%) ──`];
    for (const r of results.filter((r) => !r.passed)) lines.push(`     ✗ ${r.name}: ${r.reason}`);
    process.stdout.write(lines.join("\n") + "\n");
  });
});
