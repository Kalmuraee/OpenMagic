import { TOOLBAR_CSS } from "./styles/toolbar.css.js";
import * as ws from "./services/ws-client.js";
import { inspectElement, showHighlight, hideHighlight, type SelectedElement } from "./services/dom-inspector.js";
import { captureScreenshot } from "./services/capture.js";
import { installNetworkCapture, installConsoleCapture, buildContext } from "./services/context-builder.js";

// ── SVG Icons (Lucide-style) ─────────────────────────────────────
const ICON = {
  sparkle: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>`,
  crosshair: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
  camera: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  chat: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  settings: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  send: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  externalLink: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
  grip: `<svg width="7" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>`,
};

// ── Model Registry (inline for browser bundle) ───────────────────
const MODEL_REGISTRY: Record<string, { name: string; models: { id: string; name: string }[]; keyPlaceholder: string; local?: boolean; keyUrl?: string }> = {
  openai: { name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-...", models: [
    { id: "gpt-5.4", name: "GPT-5.4" }, { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.2", name: "GPT-5.2 Thinking" }, { id: "o3", name: "o3" }, { id: "o4-mini", name: "o4-mini" },
    { id: "gpt-4.1", name: "GPT-4.1" }, { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
  ]},
  anthropic: { name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-...", models: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" }, { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ]},
  google: { name: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AIza...", models: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" }, { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }, { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ]},
  xai: { name: "xAI (Grok)", keyUrl: "https://console.x.ai/team/default/api-keys", keyPlaceholder: "xai-...", models: [
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning" }, { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast" },
  ]},
  deepseek: { name: "DeepSeek", keyUrl: "https://platform.deepseek.com/api_keys", keyPlaceholder: "sk-...", models: [
    { id: "deepseek-chat", name: "DeepSeek V3.2" }, { id: "deepseek-reasoner", name: "DeepSeek R1" },
  ]},
  mistral: { name: "Mistral", keyUrl: "https://console.mistral.ai/api-keys", keyPlaceholder: "...", models: [
    { id: "mistral-large-3-25-12", name: "Mistral Large 3" }, { id: "codestral-2508", name: "Codestral" }, { id: "devstral-2-25-12", name: "Devstral 2" },
  ]},
  groq: { name: "Groq", keyUrl: "https://console.groq.com/keys", keyPlaceholder: "gsk_...", models: [
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" }, { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
  ]},
  minimax: { name: "MiniMax", keyUrl: "https://platform.minimax.chat/user-center/basic-information/interface-key", keyPlaceholder: "MiniMax key...", models: [
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" }, { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
  ]},
  moonshot: { name: "Kimi (Moonshot)", keyUrl: "https://platform.moonshot.cn/console/api-keys", keyPlaceholder: "Moonshot key...", models: [
    { id: "kimi-k2.5", name: "Kimi K2.5" }, { id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
  ]},
  qwen: { name: "Qwen (Alibaba)", keyUrl: "https://dashscope.console.aliyun.com/apiKey", keyPlaceholder: "DashScope key...", models: [
    { id: "qwen3.5-plus", name: "Qwen 3.5 Plus" }, { id: "qwen-max", name: "Qwen Max" },
  ]},
  zhipu: { name: "Zhipu AI (GLM)", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys", keyPlaceholder: "Zhipu key...", models: [
    { id: "glm-5", name: "GLM-5" }, { id: "glm-4.7", name: "GLM-4.7" },
  ]},
  doubao: { name: "Doubao (ByteDance)", keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey", keyPlaceholder: "Volcano key...", models: [
    { id: "doubao-seed-2-0-pro", name: "Doubao Seed 2.0 Pro" }, { id: "doubao-seed-2-0-code", name: "Doubao Seed 2.0 Code" },
  ]},
  ollama: { name: "Ollama (Local)", keyPlaceholder: "not required", local: true, models: [] },
  openrouter: { name: "OpenRouter", keyUrl: "https://openrouter.ai/settings/keys", keyPlaceholder: "sk-or-...", models: [] },
};

const CURRENT_VERSION = "0.12.0";

// ── State ────────────────────────────────────────────────────────
const state = {
  connected: false,
  panelOpen: false,
  activePanel: "" as "" | "chat" | "settings",
  selecting: false,
  selectedElement: null as SelectedElement | null,
  screenshot: null as string | null,
  messages: [] as { role: "user" | "assistant" | "system"; content: string }[],
  streaming: false,
  streamContent: "",
  provider: "",
  model: "",
  hasApiKey: false,
  roots: [] as string[],
  updateAvailable: false,
  latestVersion: "",
  saveStatus: "" as "" | "saving" | "saved" | "error",
};

// ── DOM refs (created once) ──────────────────────────────────────
let shadow: ShadowRoot;
let $toolbar: HTMLDivElement;
let $promptInput: HTMLInputElement;
let $promptCtx: HTMLDivElement;
let $panel: HTMLDivElement;
let $panelBody: HTMLDivElement;

// ── Initialize ───────────────────────────────────────────────────
function init() {
  if (document.querySelector("openmagic-toolbar")) return;

  const host = document.createElement("openmagic-toolbar");
  host.dataset.openmagic = "true";
  shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = TOOLBAR_CSS;
  shadow.appendChild(style);

  const root = document.createElement("div");
  shadow.appendChild(root);

  // Build DOM structure ONCE
  root.innerHTML = buildStaticDOM();

  // Cache refs
  $toolbar = root.querySelector(".om-toolbar")!;
  $promptInput = root.querySelector(".om-prompt-input")!;
  $promptCtx = root.querySelector(".om-prompt-context")!;
  $panel = root.querySelector(".om-panel")!;
  $panelBody = root.querySelector(".om-panel-body")!;

  document.body.appendChild(host);

  // Attach event delegation ONCE
  attachGlobalEvents(root);
  setupDraggable();

  // Restore persisted toolbar position
  try {
    const pos = JSON.parse(localStorage.getItem("__om_pos__") || "");
    if (pos?.left && pos?.top) {
      $toolbar.style.left = pos.left;
      $toolbar.style.top = pos.top;
      $toolbar.style.right = "auto";
      $toolbar.style.bottom = "auto";
    }
  } catch {}

  installNetworkCapture();
  installConsoleCapture();
  checkForUpdates();

  // Connect to server — same origin (single port)
  const token = (window as any).__OPENMAGIC_TOKEN__;
  const wsPort = parseInt(window.location.port, 10) || (window.location.protocol === "https:" ? 443 : 80);
  if (token) {
    ws.connect(wsPort, token)
      .then(() => {
        state.connected = true;
        updateStatusDot();
        return ws.request("config.get");
      })
      .then((msg: any) => {
        state.provider = msg.payload?.provider || "";
        state.model = msg.payload?.model || "";
        state.hasApiKey = msg.payload?.hasApiKey || false;
        state.roots = msg.payload?.roots || [];
        if (!state.provider || !state.hasApiKey) {
          openPanel("settings");
        }
        updatePillButtons();
      })
      .catch(() => {
        state.connected = false;
        updateStatusDot();
      });
  }
}

function buildStaticDOM(): string {
  return `
    <div class="om-toolbar">
      <div class="om-toolbar-header">
        <span class="om-grab">${ICON.grip}</span>
        <span class="om-pill-brand">
          <span class="om-pill-icon">${ICON.sparkle}</span>
          <span class="om-pill-text">OpenMagic</span>
        </span>
        <span class="om-pill-divider"></span>
        <button class="om-pill-btn" data-action="select" title="Select element">${ICON.crosshair}</button>
        <button class="om-pill-btn" data-action="screenshot" title="Screenshot">${ICON.camera}</button>
        <span class="om-pill-divider"></span>
        <button class="om-pill-btn" data-action="chat" title="Chat">${ICON.chat}</button>
        <button class="om-pill-btn" data-action="settings" title="Settings">${ICON.settings}</button>
        <span class="om-status-dot disconnected"></span>
      </div>
      <div class="om-panel om-hidden">
        <div class="om-panel-header">
          <span class="om-panel-title"></span>
          <span class="om-panel-version">v${CURRENT_VERSION}</span>
          <button class="om-panel-close" data-action="close-panel">${ICON.x}</button>
        </div>
        <div class="om-panel-body"></div>
      </div>
      <div class="om-prompt-row">
        <div class="om-prompt-context"></div>
        <input class="om-prompt-input" type="text" placeholder="Describe what to change..." autocomplete="off" />
        <button class="om-prompt-send" data-action="prompt-send">${ICON.send}</button>
      </div>
    </div>`;
}

// ── Event Delegation (attached ONCE) ─────────────────────────────
function attachGlobalEvents(root: HTMLElement) {
  // Click delegation
  root.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const action = target.dataset.action!;
    handleAction(action, target);
  });

  // Change delegation (dropdowns)
  root.addEventListener("change", (e) => {
    const target = e.target as HTMLSelectElement;
    const field = target.dataset.field;
    if (!field) return;

    if (field === "provider") {
      state.provider = target.value;
      state.model = "";
      state.saveStatus = "";
      refreshPanelContent();
    } else if (field === "model") {
      state.model = target.value;
    }
  });

  // Prompt input: Enter to send
  $promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  // Listen for reconnection events
  ws.onMessage((msg: any) => {
    if (msg.type === "reconnected") {
      state.connected = true;
      updateStatusDot();
    }
  });
}

function resolveFilePath(rel: string): string {
  return state.roots.length > 0 ? state.roots[0] + "/" + rel : rel;
}

async function applyDiff(target: HTMLElement) {
  const file = target.dataset.file;
  const searchB64 = target.dataset.search;
  const replaceB64 = target.dataset.replace;
  if (!file || !searchB64 || !replaceB64) return;

  const search = atob(searchB64);
  const replace = atob(replaceB64);
  const card = target.closest(".om-diff-card") as HTMLElement | null;

  try {
    const fileResult = await ws.request("fs.read", { path: resolveFilePath(file) });
    const content = fileResult.payload?.content;
    if (content?.includes(search)) {
      const writeResult = await ws.request("fs.write", { path: resolveFilePath(file), content: content.replace(search, replace) });
      if (writeResult?.payload?.ok === false) {
        state.messages.push({ role: "system", content: `Write failed: ${file} - ${writeResult.payload.error || "unknown"}` });
      } else {
        // Update the diff message to "Applied"
        const idx = card?.dataset.diffIdx;
        if (idx !== undefined) {
          state.messages[parseInt(idx)] = { role: "system", content: `Applied change to ${file}` };
        }
      }
    } else {
      state.messages.push({ role: "system", content: `Could not find matching code in ${file}` });
    }
  } catch (e: any) {
    state.messages.push({ role: "system", content: `Failed: ${file} - ${e.message}` });
  }

  refreshPanelContent();
  scrollChatToBottom();
}

function rejectDiff(target: HTMLElement) {
  const idx = target.dataset.idx;
  if (idx !== undefined) {
    const i = parseInt(idx);
    const parts = state.messages[i]?.content.split("__");
    const file = parts?.[3] || "file";
    state.messages[i] = { role: "system", content: `Rejected change to ${file}` };
  }
  refreshPanelContent();
  scrollChatToBottom();
}

function handleAction(action: string, target: HTMLElement) {
  switch (action) {
    case "select": toggleSelectMode(); break;
    case "screenshot": takeScreenshot(); break;
    case "chat": togglePanel("chat"); break;
    case "settings": togglePanel("settings"); break;
    case "close-panel": closePanel(); break;
    case "prompt-send": sendPrompt(); break;
    case "save-settings": saveSettings(); break;
    case "get-key": {
      const url = target.dataset.url;
      if (url) window.open(url, "_blank", "noopener");
      break;
    }
    case "apply-diff": applyDiff(target); break;
    case "reject-diff": rejectDiff(target); break;
    case "clear-element": state.selectedElement = null; updatePromptContext(); break;
    case "clear-screenshot": state.screenshot = null; updatePromptContext(); break;
  }
}

// ── Targeted UI Updates (no full DOM rebuild) ────────────────────

function updateStatusDot() {
  const dot = shadow.querySelector(".om-status-dot");
  if (dot) {
    dot.className = `om-status-dot ${state.connected ? "connected" : "disconnected"}`;
  }
}

function updatePillButtons() {
  shadow.querySelectorAll(".om-pill-btn").forEach((btn) => {
    const action = (btn as HTMLElement).dataset.action;
    btn.classList.toggle("active", action === state.activePanel || (action === "select" && state.selecting));
  });
}

function updatePromptContext() {
  const chips: string[] = [];
  if (state.selectedElement) {
    chips.push(`<span class="om-prompt-chip">${state.selectedElement.tagName}${state.selectedElement.id ? "#" + state.selectedElement.id : ""} <button class="om-prompt-chip-x" data-action="clear-element">${ICON.x}</button></span>`);
  }
  if (state.screenshot) {
    chips.push(`<span class="om-prompt-chip">Screenshot <button class="om-prompt-chip-x" data-action="clear-screenshot">${ICON.x}</button></span>`);
  }
  $promptCtx.innerHTML = chips.join("");
}

// ── Panel Management ─────────────────────────────────────────────

function openPanel(panel: "chat" | "settings") {
  state.panelOpen = true;
  state.activePanel = panel;
  $panel.classList.remove("om-hidden");
  const title = shadow.querySelector(".om-panel-title");
  if (title) title.textContent = panel === "settings" ? "Settings" : "Chat";
  refreshPanelContent();
  updatePillButtons();
}

function closePanel() {
  state.panelOpen = false;
  state.activePanel = "";
  $panel.classList.add("om-hidden");
  updatePillButtons();
}

function togglePanel(panel: "chat" | "settings") {
  if (state.panelOpen && state.activePanel === panel) {
    closePanel();
  } else {
    openPanel(panel);
  }
}

function refreshPanelContent() {
  if (state.activePanel === "settings") {
    $panelBody.innerHTML = renderSettingsHTML();
  } else if (state.activePanel === "chat") {
    $panelBody.innerHTML = renderChatHTML();
    scrollChatToBottom();
  }
}

// ── Settings Renderer ────────────────────────────────────────────

function renderSettingsHTML(): string {
  const providerOpts = Object.entries(MODEL_REGISTRY)
    .map(([k, p]) => `<option value="${k}" ${state.provider === k ? "selected" : ""}>${p.name}</option>`).join("");

  const prov = MODEL_REGISTRY[state.provider];
  const modelOpts = prov
    ? prov.models.map(m => `<option value="${m.id}" ${state.model === m.id ? "selected" : ""}>${m.name}</option>`).join("")
    : '<option value="">Select provider first</option>';

  const isLocal = prov?.local || false;
  const keyUrl = prov?.keyUrl || "";
  const keyPh = prov?.keyPlaceholder || "Enter API key...";

  const updateBanner = state.updateAvailable
    ? `<div class="om-update-banner">v${state.latestVersion} available <code class="om-update-cmd">npx openmagic@latest</code></div>` : "";

  const statusHtml = state.hasApiKey
    ? `<div class="om-status om-status-success">${ICON.check} Connected</div>` : "";

  const saveBtnText = state.saveStatus === "saving" ? '<span class="om-spinner"></span> Saving...'
    : state.saveStatus === "saved" ? `${ICON.check} Saved` : "Save";
  const saveBtnClass = state.saveStatus === "saving" ? "om-btn om-btn-saving"
    : state.saveStatus === "saved" ? "om-btn om-btn-saved" : "om-btn";
  const saveBtnDisabled = state.saveStatus === "saving" ? "disabled" : "";

  return `
    ${updateBanner}
    <div class="om-settings">
      <div class="om-field">
        <label class="om-label">Provider</label>
        <select class="om-select" data-field="provider"><option value="">Select Provider...</option>${providerOpts}</select>
      </div>
      <div class="om-field">
        <label class="om-label">Model</label>
        <select class="om-select" data-field="model"><option value="">Select Model...</option>${modelOpts}</select>
      </div>
      <div class="om-field ${isLocal ? "om-hidden" : ""}">
        <label class="om-label">API Key</label>
        <div class="om-key-row">
          <input type="text" class="om-input om-key-input" data-field="apiKey" placeholder="${keyPh}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
          ${keyUrl ? `<button class="om-btn-get-key" data-action="get-key" data-url="${keyUrl}">${ICON.externalLink} Get key</button>` : ""}
        </div>
        ${keyUrl ? `<div class="om-key-hint"><a data-action="get-key" data-url="${keyUrl}">Get your ${prov?.name || ""} API key here</a></div>` : ""}
      </div>
      <button class="${saveBtnClass}" data-action="save-settings" ${saveBtnDisabled}>${saveBtnText}</button>
      ${statusHtml}
    </div>`;
}

// ── Chat Renderer ────────────────────────────────────────────────

function renderChatHTML(): string {
  if (!state.provider || (!state.hasApiKey && !MODEL_REGISTRY[state.provider]?.local)) {
    return `<div class="om-status om-status-error">Configure your provider in Settings first</div>`;
  }

  const msgs = state.messages.map((m, i) => {
    if (m.content.startsWith("__DIFF__")) {
      const parts = m.content.split("__");
      // parts: ["", "DIFF", id, file, base64search, base64replace, ""]
      const file = parts[3];
      const search = atob(parts[4]);
      const replace = atob(parts[5]);
      return `<div class="om-diff-card" data-diff-idx="${i}">
        <div class="om-diff-file">${escapeHtml(file)}</div>
        <div class="om-diff-removed">${escapeHtml(search.slice(0, 200))}</div>
        <div class="om-diff-added">${escapeHtml(replace.slice(0, 200))}</div>
        <div class="om-diff-actions">
          <button class="om-btn om-btn-sm" data-action="apply-diff" data-file="${escapeHtml(file)}" data-search="${parts[4]}" data-replace="${parts[5]}">Apply</button>
          <button class="om-btn-secondary om-btn-sm" data-action="reject-diff" data-idx="${i}">Reject</button>
        </div>
      </div>`;
    }
    return `<div class="om-msg om-msg-${m.role}">${escapeHtml(m.content)}</div>`;
  }).join("");

  const streamHtml = state.streaming
    ? `<div class="om-msg om-msg-assistant"><span class="om-spinner"></span>${escapeHtml(state.streamContent)}</div>` : "";

  const empty = !state.messages.length && !state.streaming
    ? `<div class="om-chat-empty">Select an element or type below to start</div>` : "";

  return `<div class="om-chat-messages">${empty}${msgs}${streamHtml}</div>`;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const el = $panelBody.querySelector(".om-chat-messages");
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// ── Save Settings ────────────────────────────────────────────────

async function saveSettings() {
  const apiKeyInput = $panelBody.querySelector('[data-field="apiKey"]') as HTMLInputElement;
  const apiKey = apiKeyInput?.value || "";

  if (!state.provider) {
    state.saveStatus = "error";
    updateSaveButton();
    setTimeout(() => { state.saveStatus = ""; refreshPanelContent(); }, 2000);
    return;
  }

  // Check WebSocket connection
  if (!ws.isConnected()) {
    state.saveStatus = "error";
    updateSaveButton();
    const btn = $panelBody.querySelector('[data-action="save-settings"]');
    if (btn) btn.innerHTML = "Not connected - check terminal";
    setTimeout(() => { state.saveStatus = ""; refreshPanelContent(); }, 3000);
    return;
  }

  const payload: any = { provider: state.provider, model: state.model };
  if (apiKey) payload.apiKey = apiKey;

  state.saveStatus = "saving";
  updateSaveButton();

  try {
    // Race against a 8s local timeout (don't wait 30s)
    const result = await Promise.race([
      ws.request("config.set", payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Save timed out")), 8000)),
    ]);
    state.hasApiKey = !!(apiKey || state.hasApiKey);
    state.saveStatus = "saved";
    updateSaveButton();

    // Auto-transition to chat after 1.2s
    setTimeout(() => {
      state.saveStatus = "";
      if (state.activePanel === "settings") {
        openPanel("chat");
      }
    }, 1200);
  } catch (e: any) {
    state.saveStatus = "error";
    const btn = $panelBody.querySelector('[data-action="save-settings"]');
    const msg = (e?.message || "").includes("timeout") ? "Connection timeout - is the CLI running?"
      : (e?.message || "").includes("connected") ? "Not connected to OpenMagic server"
      : `Save failed: ${e?.message || "Unknown error"}`;
    if (btn) {
      btn.innerHTML = msg;
      btn.className = "om-btn";
      (btn as HTMLButtonElement).disabled = false;
    }
    setTimeout(() => { state.saveStatus = ""; refreshPanelContent(); }, 4000);
  }
}

function updateSaveButton() {
  const btn = $panelBody.querySelector('[data-action="save-settings"]');
  if (!btn) return;
  if (state.saveStatus === "saving") {
    btn.innerHTML = '<span class="om-spinner"></span> Saving...';
    btn.className = "om-btn om-btn-saving";
    (btn as HTMLButtonElement).disabled = true;
  } else if (state.saveStatus === "saved") {
    btn.innerHTML = `${ICON.check} Saved`;
    btn.className = "om-btn om-btn-saved";
    (btn as HTMLButtonElement).disabled = false;
  } else if (state.saveStatus === "error") {
    btn.innerHTML = "Save failed - try again";
    btn.className = "om-btn";
    (btn as HTMLButtonElement).disabled = false;
  } else {
    btn.innerHTML = "Save";
    btn.className = "om-btn";
    (btn as HTMLButtonElement).disabled = false;
  }
}

// ── Send Prompt ──────────────────────────────────────────────────

async function sendPrompt() {
  const text = $promptInput.value.trim();
  if (!text || state.streaming) return;

  if (!state.provider || (!state.hasApiKey && !MODEL_REGISTRY[state.provider]?.local)) {
    openPanel("settings");
    return;
  }

  // Add user message
  state.messages.push({ role: "user", content: text });
  state.streaming = true;
  state.streamContent = "";
  $promptInput.value = "";

  // Open chat panel
  openPanel("chat");

  // Build context — includes page info, selected element, screenshot, network/console logs
  const context: any = buildContext(state.selectedElement, state.screenshot);
  context.pageUrl = window.location.href;
  context.pageTitle = document.title;

  // Grounding loop: fetch project tree + relevant source files before LLM call
  try {
    const treeResult = await ws.request("fs.list", {});
    if (treeResult?.payload?.projectTree) {
      context.projectTree = treeResult.payload.projectTree;
    }
  } catch { /* non-critical */ }

  try {
    const result = await ws.stream(
      "llm.chat",
      {
        provider: state.provider,
        model: state.model,
        messages: state.messages.map(m => ({ role: m.role, content: m.content })),
        context,
      },
      (chunk: string) => {
        state.streamContent += chunk;
        // Update the streaming message in-place
        const msgEl = $panelBody.querySelector(".om-msg-assistant:last-child");
        if (msgEl) {
          msgEl.innerHTML = `<span class="om-spinner"></span>${escapeHtml(state.streamContent)}`;
          scrollChatToBottom();
        }
      }
    );

    state.messages.push({ role: "assistant", content: state.streamContent || result?.content || "" });

    // Show diff previews for approval instead of auto-applying
    if (result?.modifications?.length) {
      for (const mod of result.modifications) {
        if (mod.type === "edit" && mod.file && mod.search && mod.replace) {
          const diffId = Math.random().toString(36).slice(2);
          state.messages.push({
            role: "system",
            content: `__DIFF__${diffId}__${mod.file}__${btoa(mod.search)}__${btoa(mod.replace)}__`,
          });
        }
      }
    }
  } catch (e: any) {
    state.messages.push({ role: "system", content: `Error: ${e.message}` });
  }

  state.streaming = false;
  state.streamContent = "";
  refreshPanelContent();
  scrollChatToBottom();
}

// ── Select Mode ──────────────────────────────────────────────────

let selectHandler: ((e: MouseEvent) => void) | null = null;
let hoverHandler: ((e: MouseEvent) => void) | null = null;

function toggleSelectMode() {
  state.selecting ? exitSelectMode() : enterSelectMode();
}

function enterSelectMode() {
  state.selecting = true;
  document.body.style.cursor = "crosshair";
  updatePillButtons();

  hoverHandler = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("openmagic-toolbar") || t.dataset?.openmagic) return;
    const r = t.getBoundingClientRect();
    showHighlight({ x: r.x, y: r.y, width: r.width, height: r.height });
  };

  selectHandler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.closest("openmagic-toolbar") || t.dataset?.openmagic) return;
    state.selectedElement = inspectElement(t);
    exitSelectMode();
    updatePromptContext();
    $promptInput.focus();
  };

  // ESC to cancel
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      exitSelectMode();
    }
  };

  document.addEventListener("mousemove", hoverHandler, true);
  document.addEventListener("click", selectHandler, true);
  document.addEventListener("keydown", escHandler, true);

  // Store for cleanup
  (enterSelectMode as any)._escHandler = escHandler;
}

function exitSelectMode() {
  state.selecting = false;
  document.body.style.cursor = "";
  hideHighlight();
  if (hoverHandler) { document.removeEventListener("mousemove", hoverHandler, true); hoverHandler = null; }
  if (selectHandler) { document.removeEventListener("click", selectHandler, true); selectHandler = null; }
  const escH = (enterSelectMode as any)._escHandler;
  if (escH) { document.removeEventListener("keydown", escH, true); (enterSelectMode as any)._escHandler = null; }
  updatePillButtons();
}

async function takeScreenshot() {
  // If element is selected, try element screenshot first
  const target = state.selectedElement ? document.querySelector(state.selectedElement.cssSelector) as HTMLElement : undefined;
  const ss = await captureScreenshot(target || undefined);
  if (ss) {
    state.screenshot = ss;
    updatePromptContext();
    $promptInput.focus();
  }
}

// ── Draggable (setup ONCE) ───────────────────────────────────────

function setupDraggable() {
  let active = false, startX = 0, startY = 0, origX = 0, origY = 0;

  $toolbar.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-action]")) return;
    if (!t.closest(".om-grab") && !t.closest(".om-pill-brand")) return;
    active = true;
    startX = e.clientX; startY = e.clientY;
    const r = $toolbar.getBoundingClientRect();
    origX = r.left; origY = r.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!active) return;
    $toolbar.style.left = (origX + e.clientX - startX) + "px";
    $toolbar.style.top = (origY + e.clientY - startY) + "px";
    $toolbar.style.right = "auto";
    $toolbar.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (active) {
      active = false;
      // Persist position
      try {
        localStorage.setItem("__om_pos__", JSON.stringify({
          left: $toolbar.style.left,
          top: $toolbar.style.top,
        }));
      } catch {}
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function checkForUpdates() {
  fetch("https://registry.npmjs.org/openmagic/latest", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  }).then(r => r.ok ? r.json() : null).then(d => {
    if (!d?.version) return;
    const l = d.version.split(".").map(Number), c = CURRENT_VERSION.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((l[i]||0) > (c[i]||0)) { state.updateAvailable = true; state.latestVersion = d.version; showUpdateDot(); return; } if ((l[i]||0) < (c[i]||0)) return; }
  }).catch(() => {});
}

function showUpdateDot() {
  const existing = shadow.querySelector(".om-update-dot");
  if (existing) return;
  const dot = document.createElement("span");
  dot.className = "om-update-dot";
  dot.title = `v${state.latestVersion} available`;
  dot.addEventListener("click", () => openPanel("settings"));
  const header = shadow.querySelector(".om-toolbar-header");
  if (header) header.appendChild(dot);
}

// ── Boot ─────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
