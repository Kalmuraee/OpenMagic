import { describe, it, expect } from "vitest";
import { runToolLoop, type ToolDriver } from "../src/llm/tool-loop.js";
import { executeServerTool, type ToolCall } from "../src/llm/tools.js";

// A scripted driver returns a queue of turns; records what tool results it received.
function scriptedDriver(turns: Array<{ toolCalls: ToolCall[]; text: string }>): ToolDriver & { submitted: any[] } {
  let i = 0;
  const submitted: any[] = [];
  return {
    submitted,
    async step() {
      return turns[Math.min(i++, turns.length - 1)];
    },
    submitToolResults(results) {
      submitted.push(results);
    },
  };
}

const noopExecute = () => ({ content: "ok" });

describe("runToolLoop", () => {
  it("returns the modifications from a propose_edits call", async () => {
    const driver = scriptedDriver([
      { toolCalls: [{ id: "1", name: "search_code", arguments: { pattern: "x" } }], text: "" },
      {
        toolCalls: [{ id: "2", name: "propose_edits", arguments: { modifications: [{ file: "a.ts", type: "edit", search: "x", replace: "y" }], explanation: "done" } }],
        text: "",
      },
    ]);
    const result = await runToolLoop(driver, (name, args) => executeServerTool(name, args, process.cwd(), [process.cwd()]), { maxSteps: 8 });
    expect(result.modifications).toHaveLength(1);
    expect(result.content).toBe("done");
    // the first (non-terminal) tool call produced a submitted result
    expect(driver.submitted.length).toBe(1);
  });

  it("returns final text (no edits) when the model stops without tool calls", async () => {
    const driver = scriptedDriver([{ toolCalls: [], text: "It's already correct." }]);
    const result = await runToolLoop(driver, noopExecute, { maxSteps: 8 });
    expect(result.modifications).toEqual([]);
    expect(result.content).toContain("already correct");
  });

  it("stops at maxSteps if the model never finalizes", async () => {
    const driver = scriptedDriver([{ toolCalls: [{ id: "1", name: "list_dir", arguments: {} }], text: "" }]);
    const result = await runToolLoop(driver, noopExecute, { maxSteps: 3 });
    expect(result.modifications).toEqual([]);
    // it kept submitting tool results until the cap
    expect(driver.submitted.length).toBe(3);
  });

  it("bails out promptly when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const driver = scriptedDriver([{ toolCalls: [{ id: "1", name: "list_dir", arguments: {} }], text: "" }]);
    const result = await runToolLoop(driver, noopExecute, { maxSteps: 8, signal: controller.signal });
    expect(result.modifications).toEqual([]);
  });
});
