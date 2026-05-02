import { decodeBase64Utf8, encodeBase64Utf8 } from "./render-utils.js";

export interface PersistedToolbarState {
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  provider?: string;
  model?: string;
  panelOpen?: boolean;
  activePanel?: string;
}

const STORAGE_KEY = "__om_state__";

export function saveToolbarState(state: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  provider: string;
  model: string;
  panelOpen: boolean;
  activePanel: string;
}): void {
  try {
    let msgs = state.messages;
    if (msgs.length > 50) {
      msgs = [...msgs.slice(0, 5), ...msgs.slice(-45)];
    }
    const prunedMsgs = msgs.map((message) => {
      if (message.content.startsWith("__DIFF__") && message.content.length > 500) {
        try {
          const diff = JSON.parse(decodeBase64Utf8(message.content.slice(8)));
          return { ...message, content: `Pending ${diff.type || "edit"} for ${diff.file || "file"} was not restored after reload.` };
        } catch {
          return message;
        }
      }
      if (message.content.startsWith("__APPLIED__") && message.content.length > 500) {
        try {
          const applied = JSON.parse(decodeBase64Utf8(message.content.slice(11)));
          delete applied.patches;
          return { ...message, content: `__APPLIED__${encodeBase64Utf8(JSON.stringify(applied))}` };
        } catch {
          return { ...message, content: "Applied patch group." };
        }
      }
      if (message.content.startsWith("__REDO__")) {
        return { ...message, content: "Patch group rolled back." };
      }
      return message;
    });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      messages: prunedMsgs,
      provider: state.provider,
      model: state.model,
      panelOpen: state.panelOpen,
      activePanel: state.activePanel,
    }));
  } catch {
    // Ignore quota or unavailable storage.
  }
}

export function restoreToolbarState(): PersistedToolbarState {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function clearToolbarState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
