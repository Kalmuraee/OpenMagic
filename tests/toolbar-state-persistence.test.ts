import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeBase64Utf8 } from "../src/toolbar/render-utils.js";
import { clearToolbarState, restoreToolbarState, saveToolbarState } from "../src/toolbar/state-persistence.js";

vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
vi.stubGlobal("atob", (value: string) => Buffer.from(value, "base64").toString("binary"));

const store = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => store.get(key) || null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
});

beforeEach(() => {
  store.clear();
});

describe("toolbar state persistence", () => {
  it("stores provider, model, and panel state", () => {
    saveToolbarState({
      messages: [{ role: "user", content: "hello" }],
      provider: "openai",
      model: "gpt-5.5",
      panelOpen: true,
      activePanel: "chat",
    });

    expect(restoreToolbarState()).toMatchObject({
      provider: "openai",
      model: "gpt-5.5",
      panelOpen: true,
      activePanel: "chat",
    });
  });

  it("does not persist large pending diff payloads as applied", () => {
    const diffPayload = encodeBase64Utf8(JSON.stringify({
      type: "edit",
      file: "src/app.ts",
      search: "x".repeat(600),
      replace: "y".repeat(600),
    }));

    saveToolbarState({
      messages: [{ role: "system", content: `__DIFF__${diffPayload}` }],
      provider: "openai",
      model: "gpt-5.5",
      panelOpen: false,
      activePanel: "",
    });

    expect(restoreToolbarState().messages?.[0].content).toBe("Pending edit for src/app.ts was not restored after reload.");
  });

  it("strips applied patch payloads and transient redo actions before storing", () => {
    const appliedPayload = encodeBase64Utf8(JSON.stringify({
      groupId: "g1",
      files: ["src/app.ts"],
      patches: [{ type: "replace", file: "src/app.ts", search: "x".repeat(600), replace: "y".repeat(600) }],
    }));
    const redoPayload = encodeBase64Utf8(JSON.stringify({
      files: ["src/app.ts"],
      patches: [{ type: "replace", file: "src/app.ts", search: "x", replace: "y" }],
    }));

    saveToolbarState({
      messages: [
        { role: "system", content: `__APPLIED__${appliedPayload}` },
        { role: "system", content: `__REDO__${redoPayload}` },
      ],
      provider: "openai",
      model: "gpt-5.5",
      panelOpen: false,
      activePanel: "",
    });

    const messages = restoreToolbarState().messages || [];
    const applied = JSON.parse(Buffer.from(messages[0].content.slice(11), "base64").toString("utf-8"));
    expect(applied).toEqual({ groupId: "g1", files: ["src/app.ts"] });
    expect(messages[1].content).toBe("Patch group rolled back.");
  });

  it("clears stored state", () => {
    saveToolbarState({
      messages: [{ role: "user", content: "hello" }],
      provider: "openai",
      model: "gpt-5.5",
      panelOpen: false,
      activePanel: "",
    });
    clearToolbarState();

    expect(restoreToolbarState()).toEqual({});
  });
});
