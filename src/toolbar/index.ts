import { TOOLBAR_CSS } from "./styles/toolbar.css.js";
import * as ws from "./services/ws-client.js";
import { inspectElement, showHighlight, hideHighlight, type SelectedElement } from "./services/dom-inspector.js";
import { captureScreenshotWithFeedback } from "./services/capture.js";
import { installNetworkCapture, installConsoleCapture, buildContext, getNetworkLogs, getConsoleLogs } from "./services/context-builder.js";

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
  copy: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  grip: `<svg width="7" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>`,
  network: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  activity: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  paperclip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  image: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  minus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
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

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const CURRENT_VERSION = "0.30.1";

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
  configuredProviders: {} as Record<string, boolean>, // which providers have keys
  roots: [] as string[],
  updateAvailable: false,
  latestVersion: "",
  saveStatus: "" as "" | "saving" | "saved" | "error",
  networkCapture: false,       // whether network panel is showing
  attachments: [] as string[], // base64 image data URLs attached to next message
  groundedFiles: [] as string[], // last grounded file paths for context chips
  minimized: false,
};

// ── DOM refs (created once) ──────────────────────────────────────
let shadow: ShadowRoot;
let $toolbar: HTMLDivElement;
let $promptInput: HTMLInputElement;
let $promptCtx: HTMLDivElement;
let $panel: HTMLDivElement;
let $panelBody: HTMLDivElement;

// ── Initialize ───────────────────────────────────────────────────
// ── State Persistence (survives HMR page reloads) ────────────────
function saveState() {
  try {
    sessionStorage.setItem("__om_state__", JSON.stringify({
      messages: state.messages,
      provider: state.provider,
      model: state.model,
      panelOpen: state.panelOpen,
      activePanel: state.activePanel,
    }));
  } catch { /* quota exceeded or unavailable */ }
}

function restoreState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("__om_state__") || "{}");
    if (saved.messages?.length) state.messages = saved.messages;
    if (saved.provider) state.provider = saved.provider;
    if (saved.model) state.model = saved.model;
    if (saved.panelOpen) { state.panelOpen = saved.panelOpen; state.activePanel = saved.activePanel || ""; }
  } catch { /* parse error or unavailable */ }
}

function init() {
  if (document.querySelector("openmagic-toolbar")) return;

  // Restore chat history and settings from session storage (survives HMR)
  restoreState();

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
  const currentScript = document.querySelector('script[data-openmagic-token]') as HTMLScriptElement | null;
  const token = currentScript?.dataset.openmagicToken || (window as any).__OPENMAGIC_TOKEN__;
  const wsPort = parseInt(window.location.port, 10) || (window.location.protocol === "https:" ? 443 : 80);
  if (token) {
    ws.connect(wsPort, token)
      .then(() => {
        state.connected = true;
        updateStatusDot();
        return ws.request("config.get");
      })
      .then((msg: any) => {
        // Merge server config with restored state (restored state takes precedence for provider/model)
        const serverProvider = msg.payload?.provider || "";
        const serverModel = msg.payload?.model || "";
        state.provider = state.provider || serverProvider;
        state.model = state.model || serverModel;
        state.configuredProviders = msg.payload?.apiKeys || {};
        state.hasApiKey = state.configuredProviders[state.provider] || false;
        state.roots = msg.payload?.roots || [];

        // Restore panel state if we had it open before refresh
        if (state.panelOpen && state.activePanel) {
          openPanel(state.activePanel as "chat" | "settings");
        } else if (!state.provider || (!state.hasApiKey && !Object.values(state.configuredProviders).some(Boolean))) {
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
          <span class="om-pill-text">✨OpenMagic🪄</span>
        </span>
        <span class="om-pill-divider"></span>
        <button class="om-pill-btn" data-action="select" title="Select element">${ICON.crosshair}</button>
        <button class="om-pill-btn" data-action="screenshot" title="Screenshot">${ICON.camera}</button>
        <button class="om-pill-btn" data-action="network" title="Network & Performance">${ICON.activity}</button>
        <span class="om-pill-divider"></span>
        <button class="om-pill-btn" data-action="chat" title="Chat">${ICON.chat}</button>
        <button class="om-pill-btn" data-action="settings" title="Settings">${ICON.settings}</button>
        <button class="om-pill-btn" data-action="minimize" title="Minimize">${ICON.minus}</button>
        <span class="om-status-dot disconnected"></span>
      </div>
      <div class="om-panel om-hidden">
        <div class="om-panel-header">
          <span class="om-panel-title"></span>
          <span class="om-panel-version">v${CURRENT_VERSION}</span>
          <button class="om-panel-clear" data-action="clear-chat" title="Clear chat">${ICON.trash}</button>
          <button class="om-panel-close" data-action="close-panel">${ICON.x}</button>
        </div>
        <div class="om-panel-body"></div>
      </div>
      <div class="om-prompt-attachments"></div>
      <div class="om-prompt-row">
        <div class="om-prompt-context"></div>
        <button class="om-prompt-attach" data-action="attach-image" title="Attach image">${ICON.paperclip}</button>
        <input class="om-prompt-input" type="text" placeholder="Describe what to change..." autocomplete="off" />
        <button class="om-prompt-send" data-action="prompt-send">${ICON.send}</button>
        <input type="file" class="om-file-input om-hidden" accept="image/*" multiple />
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
      state.model = MODEL_REGISTRY[state.provider]?.models[0]?.id || "";
      state.hasApiKey = state.configuredProviders[state.provider] || MODEL_REGISTRY[state.provider]?.local || false;
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

  // File input change handler
  const fileInput = root.querySelector(".om-file-input") as HTMLInputElement;
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      handleFileSelect(fileInput.files);
      fileInput.value = ""; // Reset so same file can be selected again
    });
  }

  // Drag and drop on prompt area
  const promptRow = root.querySelector(".om-prompt-row");
  if (promptRow) {
    promptRow.addEventListener("dragover", (e) => {
      e.preventDefault();
      (promptRow as HTMLElement).style.borderColor = "rgba(108, 92, 231, 0.5)";
    });
    promptRow.addEventListener("dragleave", () => {
      (promptRow as HTMLElement).style.borderColor = "";
    });
    promptRow.addEventListener("drop", (e) => {
      e.preventDefault();
      (promptRow as HTMLElement).style.borderColor = "";
      const dt = (e as DragEvent).dataTransfer;
      if (dt?.files?.length) handleFileSelect(dt.files);
    });

    // Also handle paste with images
    $promptInput.addEventListener("paste", (e) => {
      const items = (e as ClipboardEvent).clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            const dt = new DataTransfer();
            dt.items.add(file);
            handleFileSelect(dt.files);
          }
        }
      }
    });
  }

  // Listen for reconnection events
  ws.onMessage((msg: any) => {
    if (msg.type === "reconnected") {
      state.connected = true;
      updateStatusDot();
    }
  });

  // Global keyboard shortcuts (scoped to avoid stealing host app shortcuts)
  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd + Shift + O: toggle toolbar — always works (unique combo)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "O" || e.key === "o")) {
      e.preventDefault();
      if (state.minimized) {
        state.minimized = false;
        // Restore toolbar elements
        const headerBtns = $toolbar.querySelectorAll(".om-pill-btn:not([data-action='minimize']), .om-pill-divider, .om-status-dot");
        headerBtns.forEach(el => (el as HTMLElement).style.display = "");
        const promptRow = shadow.querySelector(".om-prompt-row") as HTMLElement;
        if (promptRow) promptRow.classList.remove("om-hidden");
      } else if (state.panelOpen) {
        closePanel();
      } else {
        openPanel("chat");
      }
      return;
    }
    // Escape: only handle if the active element is inside the toolbar shadow DOM
    // or if we're in select mode. Don't steal from host app inputs.
    if (e.key === "Escape") {
      if (state.selecting) return; // select mode has its own ESC handler
      if (state.panelOpen) {
        closePanel();
        e.preventDefault();
      }
    }
  });

  // Ctrl/Cmd + Enter in prompt: send
  $promptInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendPrompt();
    }
  });
}

function resolveFilePath(rel: string): string {
  return state.roots.length > 0 ? state.roots[0] + "/" + rel : rel;
}

function fuzzyLineMatch(content: string, search: string): { start: number; end: number } | null {
  // Normalize both to trimmed lines for comparison
  const searchLines = search.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (searchLines.length === 0) return null;

  const contentLines = content.split('\n');
  const firstSearchLine = searchLines[0];
  const lastSearchLine = searchLines[searchLines.length - 1];

  // Find candidate positions where first search line matches (trimmed)
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstSearchLine) continue;

    // Check if remaining search lines match contiguously
    if (i + searchLines.length > contentLines.length) continue;

    let allMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j]) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) {
      // Calculate byte offsets for the matched range
      let startOffset = 0;
      for (let k = 0; k < i; k++) {
        startOffset += contentLines[k].length + 1; // +1 for \n
      }
      let endOffset = startOffset;
      for (let k = i; k < i + searchLines.length; k++) {
        endOffset += contentLines[k].length + 1;
      }
      // Remove trailing \n from end offset if it's the last line
      if (endOffset > 0 && endOffset <= content.length && content[endOffset - 1] === '\n') {
        endOffset--;
      }
      return { start: startOffset, end: endOffset };
    }
  }

  // No fuzzy match found
  return null;
}

async function applyDiff(target: HTMLElement) {
  const file = target.dataset.file;
  const searchB64 = target.dataset.search;
  const replaceB64 = target.dataset.replace;
  if (!file || !searchB64 || !replaceB64) return;

  // Instant visual feedback — disable button and show spinner BEFORE any async work
  (target as HTMLButtonElement).disabled = true;
  target.innerHTML = '<span class="om-spinner"></span>';
  target.style.opacity = "0.5";
  target.style.pointerEvents = "none";

  const card = target.closest(".om-diff-card") as HTMLElement | null;
  if (card) {
    const actions = card.querySelector(".om-diff-actions");
    if (actions) actions.innerHTML = '<span class="om-spinner"></span> Applying...';
  }

  // Force browser repaint before starting async work
  await new Promise(r => requestAnimationFrame(r));

  let search: string, replace: string;
  try {
    search = decodeBase64Utf8(searchB64);
    replace = decodeBase64Utf8(replaceB64);
  } catch {
    state.messages.push({ role: "system", content: `Failed to decode diff data for ${file}` });
    refreshPanelContent();
    return;
  }

  const filePath = resolveFilePath(file);

  try {
    // Handle create (empty search = write entire file)
    if (!search && replace) {
      const writeResult = await ws.request("fs.write", { path: filePath, content: replace });
      if (writeResult?.payload?.ok === false) {
        state.messages.push({ role: "system", content: `Write failed: ${file}` });
      } else {
        const idx = card?.dataset.diffIdx;
        if (idx !== undefined) state.messages[parseInt(idx)] = { role: "system", content: `Created ${file}` };
        else state.messages.push({ role: "system", content: `Created ${file}` });
      }
      refreshPanelContent();
      scrollChatToBottom();
      return;
    }

    const fileResult = await ws.request("fs.read", { path: filePath });
    const content = fileResult?.payload?.content;

    if (!content) {
      state.messages.push({ role: "system", content: `Could not read ${file} — file may not exist at ${filePath}` });
    } else {
      // Try exact match first
      const exactCount = content.split(search).length - 1;

      if (exactCount === 1) {
        // Exact match — apply directly
        const writeResult = await ws.request("fs.write", { path: filePath, content: content.replace(search, replace) });
        if (writeResult?.payload?.ok === false) {
          state.messages.push({ role: "system", content: `Write failed: ${file} - ${writeResult.payload?.error || "unknown"}` });
        } else {
          const idx = card?.dataset.diffIdx;
          if (idx !== undefined) {
            state.messages[parseInt(idx)] = { role: "system", content: `Applied change to ${file}` };
          } else {
            state.messages.push({ role: "system", content: `Applied change to ${file}` });
          }
        }
      } else if (exactCount > 1) {
        state.messages.push({ role: "system", content: `Found ${exactCount} exact matches in ${file} — expected 1. Edit not applied.` });
      } else {
        // No exact match — try fuzzy line-based matching
        const fuzzyResult = fuzzyLineMatch(content, search);
        if (fuzzyResult) {
          const newContent = content.slice(0, fuzzyResult.start) + replace + content.slice(fuzzyResult.end);
          const writeResult = await ws.request("fs.write", { path: filePath, content: newContent });
          if (writeResult?.payload?.ok === false) {
            state.messages.push({ role: "system", content: `Write failed: ${file} - ${writeResult.payload?.error || "unknown"}` });
          } else {
            const idx = card?.dataset.diffIdx;
            if (idx !== undefined) {
              state.messages[parseInt(idx)] = { role: "system", content: `Applied change to ${file} (fuzzy match — whitespace adjusted)` };
            } else {
              state.messages.push({ role: "system", content: `Applied change to ${file} (fuzzy match)` });
            }
          }
        } else {
          state.messages.push({ role: "system", content: `No matching code found in ${file}. The file may have changed since the suggestion.` });
        }
      }
    }
  } catch (e: any) {
    state.messages.push({ role: "system", content: `Failed to apply: ${file} — ${e.message}` });
  }

  refreshPanelContent();
  scrollChatToBottom();
}

function rejectDiff(target: HTMLElement) {
  // Instant feedback
  (target as HTMLButtonElement).disabled = true;
  target.style.opacity = "0.5";

  const idx = target.dataset.idx;
  if (idx !== undefined) {
    const i = parseInt(idx);
    try {
      const diff = JSON.parse(decodeBase64Utf8(state.messages[i]?.content.slice(8) || ""));
      state.messages[i] = { role: "system", content: `Rejected change to ${diff.file || "file"}` };
    } catch {
      state.messages[i] = { role: "system", content: "Change rejected" };
    }
  }
  refreshPanelContent();
  scrollChatToBottom();
}

async function undoDiff(target: HTMLElement) {
  const file = target.dataset.file;
  if (!file) return;
  const filePath = resolveFilePath(file);
  const backupPath = filePath + ".openmagic-backup";
  try {
    const backupResult = await ws.request("fs.read", { path: backupPath });
    const backupContent = backupResult?.payload?.content;
    if (backupContent) {
      await ws.request("fs.write", { path: filePath, content: backupContent });
      state.messages.push({ role: "system", content: `Reverted change to ${file}` });
    } else {
      state.messages.push({ role: "system", content: `No backup found for ${file}` });
    }
  } catch {
    state.messages.push({ role: "system", content: `Could not revert ${file} — backup may not exist` });
  }
  refreshPanelContent();
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
    case "change-key": {
      // Show the hidden key input field
      const changeRow = shadow.querySelector("[data-key-change]");
      if (changeRow) changeRow.classList.remove("om-hidden");
      target.style.display = "none";
      break;
    }
    case "network": togglePanel("chat"); captureNetworkProfile(); break;
    case "attach-image": triggerFileAttach(); break;
    case "remove-attachment": {
      const idx = parseInt(target.dataset.idx || "0", 10);
      state.attachments.splice(idx, 1);
      renderAttachments();
      break;
    }
    case "apply-diff": applyDiff(target); break;
    case "reject-diff": rejectDiff(target); break;
    case "apply-all": {
      const gid = target.dataset.group;
      if (gid) {
        const buttons = shadow.querySelectorAll(`[data-action="apply-diff"]`);
        for (const btn of Array.from(buttons)) {
          // Check if this diff belongs to the same group by checking nearby diff card
          const card = btn.closest(".om-diff-card") as HTMLElement;
          if (card) applyDiff(btn as HTMLElement);
        }
      }
      break;
    }
    case "reject-all": {
      const gid = target.dataset.group;
      if (gid) {
        const buttons = shadow.querySelectorAll(`[data-action="reject-diff"]`);
        for (const btn of Array.from(buttons)) {
          rejectDiff(btn as HTMLElement);
        }
      }
      break;
    }
    case "undo-diff": undoDiff(target); break;
    case "clear-chat": {
      state.messages = [];
      try { sessionStorage.removeItem("__om_state__"); } catch {}
      refreshPanelContent();
      break;
    }
    case "copy-msg": {
      const idx = parseInt(target.dataset.idx || "0", 10);
      const msg = state.messages[idx];
      if (msg) {
        try { navigator.clipboard.writeText(msg.content); } catch {}
        // Brief feedback
        target.innerHTML = ICON.check;
        setTimeout(() => { target.innerHTML = ICON.copy; }, 1500);
      }
      break;
    }
    case "clear-element": state.selectedElement = null; updatePromptContext(); break;
    case "clear-screenshot": state.screenshot = null; updatePromptContext(); break;
    case "minimize": {
      state.minimized = !state.minimized;
      const panel = shadow.querySelector(".om-panel") as HTMLElement;
      const promptRow = shadow.querySelector(".om-prompt-row") as HTMLElement;
      const promptAttach = shadow.querySelector(".om-prompt-attachments") as HTMLElement;
      const headerBtns = $toolbar.querySelectorAll(".om-pill-btn:not([data-action='minimize']), .om-pill-divider, .om-status-dot");

      if (state.minimized) {
        if (panel) panel.classList.add("om-hidden");
        if (promptRow) promptRow.classList.add("om-hidden");
        if (promptAttach) promptAttach.classList.add("om-hidden");
        headerBtns.forEach(el => (el as HTMLElement).style.display = "none");
      } else {
        if (promptRow) promptRow.classList.remove("om-hidden");
        if (promptAttach) promptAttach.classList.remove("om-hidden");
        headerBtns.forEach(el => (el as HTMLElement).style.display = "");
        if (state.panelOpen && state.activePanel) {
          if (panel) panel.classList.remove("om-hidden");
        }
      }
      break;
    }
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
  if (state.attachments.length) {
    chips.push(`<span class="om-prompt-chip">${state.attachments.length} image${state.attachments.length > 1 ? "s" : ""}</span>`);
  }
  if (state.groundedFiles.length) {
    chips.push(`<span class="om-prompt-chip">${state.groundedFiles.length} files grounded</span>`);
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
  saveState();
}

// ── Settings Renderer ────────────────────────────────────────────

function renderSettingsHTML(): string {
  const providerOpts = Object.entries(MODEL_REGISTRY)
    .map(([k, p]) => {
      const configured = state.configuredProviders[k] || p.local;
      const indicator = configured ? " \u2713" : "";
      return `<option value="${k}" ${state.provider === k ? "selected" : ""}>${p.name}${indicator}</option>`;
    }).join("");

  const prov = MODEL_REGISTRY[state.provider];
  const modelOpts = prov
    ? prov.models.map(m => `<option value="${m.id}" ${state.model === m.id ? "selected" : ""}>${m.name}</option>`).join("")
    : '<option value="">Select provider first</option>';

  const isLocal = prov?.local || false;
  const keyUrl = prov?.keyUrl || "";
  const keyPh = prov?.keyPlaceholder || "Enter API key...";
  const providerHasKey = state.configuredProviders[state.provider] || false;

  const updateBanner = state.updateAvailable
    ? `<div class="om-update-banner">v${state.latestVersion} available <code class="om-update-cmd">npx openmagic@latest</code></div>` : "";

  // Show connected status if current provider has a key
  const statusHtml = (providerHasKey || isLocal)
    ? `<div class="om-status om-status-success">${ICON.check} ${prov?.name || "Provider"} connected</div>` : "";

  const saveBtnText = state.saveStatus === "saving" ? '<span class="om-spinner"></span> Saving...'
    : state.saveStatus === "saved" ? `${ICON.check} Saved` : "Save";
  const saveBtnClass = state.saveStatus === "saving" ? "om-btn om-btn-saving"
    : state.saveStatus === "saved" ? "om-btn om-btn-saved" : "om-btn";
  const saveBtnDisabled = state.saveStatus === "saving" ? "disabled" : "";

  // API key section: show "configured" state if key exists, with option to change
  let keySection = "";
  if (!isLocal && state.provider) {
    if (providerHasKey) {
      keySection = `
        <div class="om-field">
          <label class="om-label">API Key</label>
          <div class="om-key-configured">
            ${ICON.check} <span>Key configured</span>
            <button class="om-btn-change-key" data-action="change-key">Change</button>
          </div>
          <div class="om-key-change-row om-hidden" data-key-change>
            <div class="om-key-row">
              <input type="text" class="om-input om-key-input" data-field="apiKey" placeholder="${keyPh}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
              ${keyUrl ? `<button class="om-btn-get-key" data-action="get-key" data-url="${keyUrl}">${ICON.externalLink} Get key</button>` : ""}
            </div>
          </div>
        </div>`;
    } else {
      keySection = `
        <div class="om-field">
          <label class="om-label">API Key</label>
          <div class="om-key-row">
            <input type="text" class="om-input om-key-input" data-field="apiKey" placeholder="${keyPh}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
            ${keyUrl ? `<button class="om-btn-get-key" data-action="get-key" data-url="${keyUrl}">${ICON.externalLink} Get key</button>` : ""}
          </div>
          ${keyUrl ? `<div class="om-key-hint"><a data-action="get-key" data-url="${keyUrl}">Get your ${prov?.name || ""} API key here</a></div>` : ""}
        </div>`;
    }
  }

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
      ${keySection}
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
    // Diff group header: Apply All / Reject All
    if (m.content.startsWith("__DIFFGROUP__")) {
      const parts = m.content.split("__");
      const gid = parts[2];
      const count = parts[3];
      return `<div class="om-diff-group-header">
        <span>${count} file changes</span>
        <div class="om-diff-actions">
          <button class="om-btn om-btn-sm" data-action="apply-all" data-group="${gid}">Apply All</button>
          <button class="om-btn-secondary om-btn-sm" data-action="reject-all" data-group="${gid}">Reject All</button>
        </div>
      </div>`;
    }
    if (m.content.startsWith("__DIFF__")) {
      try {
        const diff = JSON.parse(decodeBase64Utf8(m.content.slice(8)));
        const isCreate = diff.type === "create" || (!diff.search && diff.replace);
        const searchB64 = encodeBase64Utf8(diff.search || "");
        const replaceB64 = encodeBase64Utf8(diff.replace || "");
        const label = isCreate ? "Create new file" : "Edit";
        return `<div class="om-diff-card" data-diff-idx="${i}">
          <div class="om-diff-file">${escapeHtml(label)}: ${escapeHtml(diff.file)}</div>
          ${diff.search ? `<div class="om-diff-removed">${escapeHtml(diff.search.slice(0, 200))}</div>` : ""}
          <div class="om-diff-added">${escapeHtml((diff.replace || "").slice(0, 300))}</div>
          <div class="om-diff-actions">
            <button class="om-btn om-btn-sm" data-action="apply-diff" data-file="${escapeHtml(diff.file)}" data-search="${searchB64}" data-replace="${replaceB64}">Apply</button>
            <button class="om-btn-secondary om-btn-sm" data-action="reject-diff" data-idx="${i}">Reject</button>
          </div>
        </div>`;
      } catch {
        return `<div class="om-msg om-msg-system">Malformed diff data</div>`;
      }
    }
    if (m.content.startsWith("Applied change to ")) {
      const file = m.content.replace("Applied change to ", "").replace(" (fuzzy match — whitespace adjusted)", "").replace(" (fuzzy match)", "");
      return `<div class="om-msg om-msg-system">${escapeHtml(m.content)} <button class="om-undo-btn" data-action="undo-diff" data-file="${escapeHtml(file)}">Undo</button></div>`;
    }
    // Regular messages with copy button
    const copyBtn = (m.role === "user" || m.role === "assistant")
      ? `<button class="om-copy-btn" data-action="copy-msg" data-idx="${i}" title="Copy">${ICON.copy}</button>`
      : "";
    if (m.role === "assistant") {
      return `<div class="om-msg om-msg-assistant">${renderMarkdown(m.content)}${copyBtn}</div>`;
    }
    return `<div class="om-msg om-msg-${m.role}">${escapeHtml(m.content)}${copyBtn}</div>`;
  }).join("");

  const streamHtml = state.streaming
    ? `<div class="om-msg om-msg-assistant"><span class="om-spinner"></span> Generating response...</div>` : "";

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
    // Mark this provider as configured
    if (apiKey && state.provider) {
      state.configuredProviders[state.provider] = true;
    }
    state.hasApiKey = !!(apiKey || state.configuredProviders[state.provider]);
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

  // Include image attachments (for vision-capable models)
  if (state.attachments.length > 0) {
    // Use the first attachment as the screenshot if none is captured
    if (!context.screenshot) {
      context.screenshot = state.attachments[0];
    }
    // Store all attachments for multi-image models
    context.attachments = [...state.attachments];
  }

  // Grounding: read project tree + score and read relevant source files
  const MAX_GROUNDED_FILES = 5;
  const MAX_GROUNDED_CHARS = 32000;
  const TEXT_RE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro|html?|css|scss|less|php|py)$/i;

  // Show grounding status
  const statusEl = $panelBody.querySelector(".om-msg-assistant:last-child");
  if (statusEl) statusEl.innerHTML = '<span class="om-spinner"></span> Reading project files...';

  try {
    const treeResult = await ws.request("fs.list", {});
    if (treeResult?.payload?.projectTree) {
      context.projectTree = treeResult.payload.projectTree;
    }

    const allFiles = (treeResult?.payload?.files || []) as Array<{ path: string; type: string }>;
    const textFiles = allFiles.filter((f: { path: string; type: string }) => f.type === "file" && TEXT_RE.test(f.path));

    // Build search tokens from multiple sources
    const tokenSources: string[] = [text];

    // Add element metadata
    if (state.selectedElement) {
      if (state.selectedElement.id) tokenSources.push(state.selectedElement.id);
      if (state.selectedElement.className) tokenSources.push(state.selectedElement.className);
      if (state.selectedElement.textContent) tokenSources.push(state.selectedElement.textContent.slice(0, 100));
      if ((state.selectedElement as any).componentHint) tokenSources.push((state.selectedElement as any).componentHint);
      // Add ancestry class/component names
      if ((state.selectedElement as any).ancestry) {
        for (const a of (state.selectedElement as any).ancestry) {
          tokenSources.push(a);
        }
      }
    }

    const searchTokens = tokenSources
      .filter(Boolean).join(" ").toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter((t: string) => t.length >= 2 && !["the", "to", "in", "of", "and", "div", "span", "class", "style"].includes(t));

    // Extract URL route segments (highest signal for finding the right page component)
    const pathname = window.location.pathname;
    const routeTokens = pathname.split("/").filter((s: string) => s.length > 1 && !/^\d+$/.test(s));

    const scored = textFiles.map((f: { path: string; type: string }) => {
      let score = 0;
      const lower = f.path.toLowerCase();

      // Route match: files matching URL path get highest priority (+15)
      for (const rt of routeTokens) {
        if (lower.includes(rt.toLowerCase())) score += 15;
      }

      // Component hint match (+12)
      if ((state.selectedElement as any)?.componentHint) {
        const hint = (state.selectedElement as any).componentHint.toLowerCase();
        if (lower.includes(hint)) score += 12;
      }

      // Token match from prompt/element (+5)
      for (const token of searchTokens) {
        if (lower.includes(token)) score += 5;
      }

      // Framework patterns (+3)
      if (/(component|page|route|layout|template|view)/.test(lower)) score += 3;
      // Page/route files for current route get extra (+5)
      if (/page\.[jt]sx?$|layout\.[jt]sx?$|\+page\.svelte$/.test(lower)) score += 5;

      return { ...f, score };
    }).sort((a: { score: number }, b: { score: number }) => b.score - a.score);

    // Read top scored files + their co-located stylesheets
    const files: Array<{ path: string; content: string }> = [];
    const readPaths = new Set<string>();
    let totalChars = 0;

    for (const f of scored.slice(0, MAX_GROUNDED_FILES)) {
      if (f.score <= 0) break;
      if (totalChars >= MAX_GROUNDED_CHARS) break;
      try {
        const root = state.roots[0] || "";
        const fullPath = root ? `${root}/${f.path}` : f.path;
        const result = await ws.request("fs.read", { path: fullPath });
        const content = String(result?.payload?.content || "");
        if (!content) continue;
        const maxChars = Math.min(8000, MAX_GROUNDED_CHARS - totalChars);
        let trimmed = content.slice(0, maxChars);
        if (content.length > maxChars) {
          trimmed += `\n// [FILE TRUNCATED — showing ${maxChars} of ${content.length} chars]`;
        }
        files.push({ path: f.path, content: trimmed });
        readPaths.add(f.path);
        totalChars += trimmed.length;

        // Auto-read co-located stylesheet (Component.module.css, Component.scss, etc.)
        const baseName = f.path.replace(/\.[^.]+$/, "");
        const styleExts = [".module.css", ".module.scss", ".css", ".scss", ".styles.ts"];
        for (const ext of styleExts) {
          const stylePath = baseName + ext;
          if (readPaths.has(stylePath) || totalChars >= MAX_GROUNDED_CHARS) continue;
          const match = textFiles.find((tf: { path: string }) => tf.path === stylePath);
          if (match) {
            try {
              const sr = await ws.request("fs.read", { path: root ? `${root}/${stylePath}` : stylePath });
              const sc = String(sr?.payload?.content || "");
              if (sc) {
                const stMax = Math.min(4000, MAX_GROUNDED_CHARS - totalChars);
                let st = sc.slice(0, stMax);
                if (sc.length > stMax) {
                  st += `\n// [FILE TRUNCATED — showing ${stMax} of ${sc.length} chars]`;
                }
                files.push({ path: stylePath, content: st });
                readPaths.add(stylePath);
                totalChars += st.length;
              }
            } catch {}
            break; // Only read the first matching style file
          }
        }
        // Follow imports: extract local imports from the file and auto-read referenced components
        const importMatches = content.matchAll(/(?:import|from)\s+['"]\.?\.\/([\w/.-]+)['"]/g);
        for (const im of importMatches) {
          if (totalChars >= MAX_GROUNDED_CHARS) break;
          const importPath = im[1];
          // Find matching file in the project (try with common extensions)
          const dir = f.path.replace(/\/[^/]+$/, "");
          const candidates = [
            `${dir}/${importPath}`,
            `${dir}/${importPath}.tsx`,
            `${dir}/${importPath}.ts`,
            `${dir}/${importPath}.jsx`,
            `${dir}/${importPath}.js`,
            `${dir}/${importPath}/index.tsx`,
            `${dir}/${importPath}/index.ts`,
          ];
          for (const candidate of candidates) {
            if (readPaths.has(candidate)) break;
            const found = textFiles.find((tf: { path: string }) => tf.path === candidate);
            if (found) {
              try {
                const ir = await ws.request("fs.read", { path: root ? `${root}/${candidate}` : candidate });
                const ic = String(ir?.payload?.content || "");
                if (ic) {
                  const imMax = Math.min(8000, MAX_GROUNDED_CHARS - totalChars);
                  let it = ic.slice(0, imMax);
                  if (ic.length > imMax) it += `\n// [FILE TRUNCATED — showing ${imMax} of ${ic.length} chars]`;
                  files.push({ path: candidate, content: it });
                  readPaths.add(candidate);
                  totalChars += it.length;
                }
              } catch {}
              break;
            }
          }
        }
      } catch { /* skip unreadable files */ }
    }

    // Also read package.json for dependency/framework awareness
    if (totalChars < MAX_GROUNDED_CHARS) {
      try {
        const root = state.roots[0] || "";
        const pkgResult = await ws.request("fs.read", { path: root ? `${root}/package.json` : "package.json" });
        const pkgContent = String(pkgResult?.payload?.content || "");
        if (pkgContent) {
          // Extract just dependencies section (not the full package.json)
          try {
            const pkg = JSON.parse(pkgContent);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const depsStr = JSON.stringify(deps, null, 2);
            files.push({ path: "package.json (dependencies)", content: depsStr.slice(0, 2000) });
          } catch {
            files.push({ path: "package.json", content: pkgContent.slice(0, 2000) });
          }
        }
      } catch {}
    }

    if (files.length) {
      context.files = files;
      // Show grounded files in status
      const fileNames = files.map((f: {path: string}) => f.path.split("/").pop()).join(", ");
      if (statusEl) statusEl.innerHTML = `<span class="om-spinner"></span> Thinking... (${files.length} files: ${fileNames})`;
    }
    state.groundedFiles = files.map((f: {path: string}) => f.path);
  } catch { /* grounding is best-effort */ }

  // Auto-retry loop: if LLM says "NEED_FILE: path", read it and retry
  const MAX_RETRIES = 4;
  let retryCount = 0;

  try {
    while (retryCount <= MAX_RETRIES) {
      state.streamContent = "";

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
          // Don't show raw JSON chunks — just keep the spinner
          // The clean formatted response will appear after streaming completes
        }
      );

      const responseContent = state.streamContent || result?.content || "";

      // Check if LLM is requesting a file (NEED_FILE pattern)
      // Try multiple patterns to detect file requests from LLM
      const needFileMatch = responseContent.match(/NEED_FILE:\s*"?([^\s"}\]]+)"?/)
        || responseContent.match(/(?:need|provide|show|read|see|contents?\s+of)\s+(?:the\s+)?(?:file\s+)?[`"']?([a-zA-Z0-9_/.@-]+\.[a-z]{1,5})[`"']?/i)
        || responseContent.match(/(?:source\s+(?:file|code)\s+(?:for|of|at))\s+[`"']?([a-zA-Z0-9_/.@-]+\.[a-z]{1,5})[`"']?/i);
      if (needFileMatch && !result?.modifications?.length && retryCount < MAX_RETRIES) {
        const neededFile = needFileMatch[1].trim();
        retryCount++;

        // Update status
        state.messages.push({ role: "system", content: `Reading ${neededFile}...` });
        refreshPanelContent();

        // Read the requested file and add to context
        try {
          const root = state.roots[0] || "";
          const filePath = root ? `${root}/${neededFile}` : neededFile;
          const fileResult = await ws.request("fs.read", { path: filePath });
          const content = String(fileResult?.payload?.content || "");
          if (content) {
            if (!context.files) context.files = [];
            context.files.push({ path: neededFile, content: content.slice(0, 8000) });
            // Add as assistant message so context carries forward
            state.messages.push({ role: "assistant", content: responseContent });
            state.messages.push({ role: "user", content: `Here is ${neededFile}. Now please make the edit.` });
          } else {
            state.messages.push({ role: "system", content: `Could not read ${neededFile}` });
            break;
          }
        } catch {
          state.messages.push({ role: "system", content: `File not found: ${neededFile}` });
          break;
        }
        continue; // Retry with the new file context
      }

      // Got a real response — extract clean text from JSON wrapper
      let displayContent = responseContent;
      try {
        const parsed = JSON.parse(responseContent);
        if (parsed.explanation) displayContent = parsed.explanation;
      } catch {
        const mdMatch = responseContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (mdMatch) {
          try {
            const p = JSON.parse(mdMatch[1]);
            if (p.explanation) displayContent = p.explanation;
          } catch {}
        }
      }
      state.messages.push({ role: "assistant", content: displayContent });

      if (result?.modifications?.length) {
        const groupId = Math.random().toString(36).slice(2);
        const validMods = result.modifications.filter((m: any) =>
          (m.type === "edit" && m.file && m.search && m.replace) ||
          (m.type === "create" && m.file && m.content)
        );

        // Show Apply All / Reject All for multi-file changes
        if (validMods.length > 1) {
          state.messages.push({
            role: "system",
            content: `__DIFFGROUP__${groupId}__${validMods.length}`,
          });
        }

        for (const mod of result.modifications) {
          if (mod.type === "edit" && mod.file && mod.search && mod.replace) {
            const diffId = Math.random().toString(36).slice(2);
            const diffPayload = JSON.stringify({ id: diffId, file: mod.file, search: mod.search, replace: mod.replace, groupId });
            state.messages.push({
              role: "system",
              content: `__DIFF__${encodeBase64Utf8(diffPayload)}`,
            });
          } else if (mod.type === "create" && mod.file && (mod as any).content) {
            const diffId = Math.random().toString(36).slice(2);
            const diffPayload = JSON.stringify({ id: diffId, file: mod.file, search: "", replace: (mod as any).content, type: "create", groupId });
            state.messages.push({
              role: "system",
              content: `__DIFF__${encodeBase64Utf8(diffPayload)}`,
            });
          } else if (mod.type === "delete" && mod.file) {
            state.messages.push({
              role: "system",
              content: `LLM proposed deleting ${mod.file} — skipped (use edit with search/replace instead)`,
            });
          }
        }
      }
      break; // Done — no more retries needed
    }
  } catch (e: any) {
    state.messages.push({ role: "system", content: `Error: ${e.message}` });
  }

  state.streaming = false;
  state.streamContent = "";
  state.attachments = [];
  renderAttachments();
  refreshPanelContent();
  scrollChatToBottom();
}

// ── Network & Profiling ──────────────────────────────────────────

function captureNetworkProfile() {
  // Capture performance timing
  const perf = window.performance;
  const navEntry = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const paintEntries = perf.getEntriesByType("paint");
  const resources = perf.getEntriesByType("resource").slice(-20) as PerformanceResourceTiming[];

  const networkLogs = getNetworkLogs();
  const consoleLogs = getConsoleLogs();

  // Build a summary message
  const lines: string[] = [];
  lines.push("--- Network & Performance Capture ---");

  if (navEntry) {
    lines.push(`Page load: ${Math.round(navEntry.loadEventEnd - navEntry.startTime)}ms`);
    lines.push(`DOM ready: ${Math.round(navEntry.domContentLoadedEventEnd - navEntry.startTime)}ms`);
    lines.push(`TTFB: ${Math.round(navEntry.responseStart - navEntry.startTime)}ms`);
  }

  const fcp = paintEntries.find(e => e.name === "first-contentful-paint");
  if (fcp) lines.push(`FCP: ${Math.round(fcp.startTime)}ms`);

  // ALL network requests from Performance API (includes page-load requests)
  if (resources.length) {
    const apiRequests = resources.filter(r =>
      r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest"
    );
    const allRequests = apiRequests.length > 0 ? apiRequests : resources;

    lines.push(`\nAll network requests (${allRequests.length}):`);
    for (const r of allRequests.slice(-30)) {
      const url = r.name.length > 80 ? "..." + r.name.slice(-77) : r.name;
      const status = (r as any).responseStatus || "";
      lines.push(`  ${Math.round(r.duration)}ms ${status ? `[${status}]` : ""} ${url}`);
    }
  }

  // Also include captured fetch/XHR logs (may have status codes)
  if (networkLogs.length) {
    lines.push(`\nFetch/XHR requests (${networkLogs.length}):`);
    for (const log of networkLogs.slice(-20)) {
      lines.push(`  ${log.method} ${log.url.slice(0, 80)} → ${log.status || "pending"} (${log.duration || "?"}ms)`);
    }
  }

  if (consoleLogs.length) {
    const errors = consoleLogs.filter(l => l.level === "error");
    const warns = consoleLogs.filter(l => l.level === "warn");
    if (errors.length) lines.push(`\nConsole errors: ${errors.length}`);
    if (warns.length) lines.push(`Console warnings: ${warns.length}`);
  }

  // Slowest resources
  if (resources.length > 5) {
    const slowest = [...resources].sort((a, b) => b.duration - a.duration).slice(0, 5);
    lines.push(`\nSlowest resources:`);
    for (const r of slowest) {
      lines.push(`  ${Math.round(r.duration)}ms — ${r.name.split("/").pop()?.slice(0, 60)}`);
    }
  }

  // Add as a system message in the chat
  state.messages.push({ role: "system", content: lines.join("\n") });
  refreshPanelContent();
  scrollChatToBottom();
  updatePromptContext();
}

// ── File Attachments ─────────────────────────────────────────────

function triggerFileAttach() {
  const input = shadow.querySelector(".om-file-input") as HTMLInputElement;
  if (input) input.click();
}

function handleFileSelect(files: FileList | null) {
  if (!files) return;
  for (let i = 0; i < files.length && state.attachments.length < 5; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;
    if (file.size > 10 * 1024 * 1024) continue; // 10MB max
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        state.attachments.push(reader.result);
        renderAttachments();
      }
    };
    reader.readAsDataURL(file);
  }
}

function renderAttachments() {
  const container = shadow.querySelector(".om-prompt-attachments");
  if (!container) return;
  if (!state.attachments.length) {
    container.innerHTML = "";
    container.classList.add("om-hidden");
    return;
  }
  container.classList.remove("om-hidden");
  container.innerHTML = state.attachments.map((a, i) =>
    `<div class="om-attachment-thumb">
      <img src="${a}" alt="attachment" />
      <button class="om-attachment-remove" data-action="remove-attachment" data-idx="${i}">${ICON.x}</button>
    </div>`
  ).join("");
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
  let target: HTMLElement | undefined;
  try {
    const sel = state.selectedElement?.cssSelector?.trim();
    if (sel) target = (document.querySelector(sel) as HTMLElement) || undefined;
  } catch { /* stale or invalid selector */ }

  // Try programmatic capture first
  const result = await captureScreenshotWithFeedback(target || undefined);

  // Check if we got a real screenshot (not just the fallback info card)
  const isRealScreenshot = result.data && result.data.length > 5000; // Real screenshots are >5KB

  if (isRealScreenshot) {
    state.screenshot = result.data;
    updatePromptContext();
    $promptInput.focus();
  } else {
    // Programmatic capture failed or only got metadata — guide user to paste
    state.messages.push({
      role: "system",
      content: "Take a screenshot manually (Cmd+Shift+4 on Mac, Win+Shift+S on Windows), then paste it here (Ctrl+V) or drag it onto the prompt bar."
    });
    openPanel("chat");
    refreshPanelContent();
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

function renderMarkdown(text: string): string {
  // First: convert literal \n strings to actual newlines (from JSON escaping)
  let clean = text.replace(/\\n/g, "\n");
  let html = escapeHtml(clean);
  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="om-code-block"><code>$2</code></pre>');
  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code class="om-inline-code">$1</code>');
  // Bold (**...**)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic (*...*)
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Bullet lists (- item)
  html = html.replace(/^- (.+)$/gm, '&#8226; $1');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
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
