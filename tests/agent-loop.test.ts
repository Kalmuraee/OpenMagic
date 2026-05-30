import { describe, expect, it, vi } from "vitest";
import { extractAgentDirectives, runAgentLoop, type AgentTurn } from "../src/llm/agent-loop.js";

function turn(p: Partial<AgentTurn>): AgentTurn {
  return { text: "", modifications: [], needFiles: [], searchQueries: [], ...p };
}

describe("runAgentLoop", () => {
  it("returns modifications immediately when the first turn finalizes", async () => {
    const step = vi.fn().mockResolvedValue(turn({ text: "done", modifications: [{ file: "a.ts", type: "edit", search: "x", replace: "y" }] }));
    const r = await runAgentLoop({ step, readFile: async () => null, search: async () => "" }, { maxSteps: 8 });
    expect(r.modifications).toHaveLength(1);
    expect(r.steps).toBe(1);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("reads requested files, accumulates them, then finalizes", async () => {
    const seenFilesPerStep: number[] = [];
    const step = vi.fn(async (ctx: any) => {
      seenFilesPerStep.push(ctx.files.length);
      return ctx.files.length === 0
        ? turn({ needFiles: ["src/a.ts"] })
        : turn({ text: "ok", modifications: [{ file: "src/a.ts", type: "edit", search: "a", replace: "b" }] });
    });
    const readFile = vi.fn(async (p: string) => (p === "src/a.ts" ? "contents of a" : null));
    const r = await runAgentLoop({ step, readFile, search: async () => "" }, { maxSteps: 8 });
    expect(r.modifications).toHaveLength(1);
    expect(r.steps).toBe(2);
    expect(readFile).toHaveBeenCalledWith("src/a.ts");
    expect(seenFilesPerStep).toEqual([0, 1]); // file was injected before the 2nd step
  });

  it("does not re-read a file it already pulled in (dedup)", async () => {
    const step = vi.fn().mockResolvedValue(turn({ needFiles: ["src/a.ts"] })); // always asks for the same file
    const readFile = vi.fn(async () => "contents");
    const r = await runAgentLoop({ step, readFile, search: async () => "" }, { maxSteps: 5 });
    expect(readFile).toHaveBeenCalledTimes(1); // only the first request reads
    expect(r.modifications).toEqual([]);
  });

  it("stops when a turn makes no progress (no edits, nothing readable)", async () => {
    const step = vi.fn().mockResolvedValue(turn({ text: "I am stuck", needFiles: ["missing.ts"] }));
    const readFile = vi.fn(async () => null); // file not found
    const r = await runAgentLoop({ step, readFile, search: async () => "" }, { maxSteps: 8 });
    expect(r.content).toContain("stuck");
    expect(r.steps).toBe(1);
  });

  it("respects the step budget", async () => {
    let n = 0;
    const step = vi.fn(async () => turn({ needFiles: [`f${n++}.ts`] })); // always a new file
    const r = await runAgentLoop({ step, readFile: async () => "c", search: async () => "" }, { maxSteps: 3 });
    expect(r.steps).toBe(3);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it("extractAgentDirectives pulls NEED_FILE and SEARCH_FILES out of a response", () => {
    const d = extractAgentDirectives('I need more: NEED_FILE: src/app/page.tsx and SEARCH_FILES: "nav-group"');
    expect(d.needFiles).toEqual(["src/app/page.tsx"]);
    expect(d.searchQueries).toEqual(["nav-group"]);
  });

  it("emits step/done events", async () => {
    const events: string[] = [];
    const step = vi.fn().mockResolvedValue(turn({ modifications: [{ file: "a", type: "edit", search: "x", replace: "y" }] }));
    await runAgentLoop({ step, readFile: async () => null, search: async () => "", onEvent: (e) => events.push(e.type) }, { maxSteps: 4 });
    expect(events).toContain("step");
    expect(events).toContain("done");
  });
});
