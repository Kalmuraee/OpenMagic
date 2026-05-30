import { describe, expect, it } from "vitest";
import { filterCommands, type Command } from "../src/toolbar/command-palette.js";

const cmds: Command[] = [
  { id: "toggle", label: "Toggle panel", action: "toggle-panel" },
  { id: "select", label: "Select element", action: "select", keywords: ["pick", "inspect"] },
  { id: "settings", label: "Open settings", action: "open-settings" },
  { id: "undo", label: "Undo last change", action: "undo" },
];

describe("filterCommands", () => {
  it("returns all commands (original order) for an empty query", () => {
    expect(filterCommands(cmds, "").map((c) => c.id)).toEqual(["toggle", "select", "settings", "undo"]);
  });

  it("matches on a label substring", () => {
    expect(filterCommands(cmds, "settings").map((c) => c.id)).toEqual(["settings"]);
  });

  it("matches on a keyword", () => {
    expect(filterCommands(cmds, "inspect").map((c) => c.id)).toContain("select");
  });

  it("matches a fuzzy subsequence", () => {
    // "tp" is a subsequence of "Toggle Panel"
    expect(filterCommands(cmds, "tp").map((c) => c.id)).toContain("toggle");
  });

  it("ranks a prefix match above a mid-string match", () => {
    const list: Command[] = [
      { id: "a", label: "Reopen settings", action: "x" },
      { id: "b", label: "Settings", action: "y" },
    ];
    expect(filterCommands(list, "sett")[0].id).toBe("b");
  });

  it("returns nothing when there is no match", () => {
    expect(filterCommands(cmds, "zzzzz")).toEqual([]);
  });
});
