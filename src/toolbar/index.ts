import { TOOLBAR_CSS } from "./styles/toolbar.css.js";
import * as ws from "./services/ws-client.js";
import {
  inspectElement,
  showHighlight,
  hideHighlight,
  removeHighlight,
  type SelectedElement,
} from "./services/dom-inspector.js";
import { captureScreenshot } from "./services/capture.js";
import {
  installNetworkCapture,
  installConsoleCapture,
  buildContext,
} from "./services/context-builder.js";

// Inline model registry (bundled into toolbar IIFE)
const MODEL_REGISTRY: Record<string, { name: string; models: { id: string; name: string }[]; keyPlaceholder: string; local?: boolean }> = {
  openai: { name: "OpenAI", models: [
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-pro", name: "GPT-5.4 Pro" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
    { id: "gpt-5.2", name: "GPT-5.2 Thinking" },
    { id: "gpt-5.2-pro", name: "GPT-5.2 Pro" },
    { id: "o3", name: "o3 (Reasoning)" },
    { id: "o4-mini", name: "o4-mini (Reasoning)" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "codex-mini-latest", name: "Codex Mini" },
  ], keyPlaceholder: "sk-..." },
  anthropic: { name: "Anthropic", models: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
  ], keyPlaceholder: "sk-ant-..." },
  google: { name: "Google Gemini", models: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ], keyPlaceholder: "AIza..." },
  xai: { name: "xAI (Grok)", models: [
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning" },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20" },
    { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast Reasoning" },
    { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast" },
  ], keyPlaceholder: "xai-..." },
  deepseek: { name: "DeepSeek", models: [
    { id: "deepseek-chat", name: "DeepSeek V3.2" },
    { id: "deepseek-reasoner", name: "DeepSeek R1" },
  ], keyPlaceholder: "sk-..." },
  mistral: { name: "Mistral", models: [
    { id: "mistral-large-3-25-12", name: "Mistral Large 3" },
    { id: "mistral-small-4-0-26-03", name: "Mistral Small 4" },
    { id: "codestral-2508", name: "Codestral" },
    { id: "devstral-2-25-12", name: "Devstral 2" },
    { id: "magistral-medium-1-2-25-09", name: "Magistral Medium" },
  ], keyPlaceholder: "..." },
  groq: { name: "Groq", models: [
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    { id: "qwen/qwen3-32b", name: "Qwen 3 32B" },
  ], keyPlaceholder: "gsk_..." },
  ollama: { name: "Ollama (Local)", models: [], keyPlaceholder: "not required", local: true },
  openrouter: { name: "OpenRouter", models: [], keyPlaceholder: "sk-or-..." },
};

const CURRENT_VERSION = "0.3.0";

// --- State ---
interface AppState {
  connected: boolean;
  panelOpen: boolean;
  activePanel: "chat" | "settings" | null;
  selecting: boolean;
  selectedElement: SelectedElement | null;
  screenshot: string | null;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  streaming: boolean;
  streamContent: string;
  provider: string;
  model: string;
  hasApiKey: boolean;
  roots: string[];
  updateAvailable: boolean;
  latestVersion: string;
}

const state: AppState = {
  connected: false,
  panelOpen: false,
  activePanel: null,
  selecting: false,
  selectedElement: null,
  screenshot: null,
  messages: [],
  streaming: false,
  streamContent: "",
  provider: "",
  model: "",
  hasApiKey: false,
  roots: [],
  updateAvailable: false,
  latestVersion: "",
};

// --- DOM References ---
let shadow: ShadowRoot;
let container: HTMLDivElement;

// --- Initialize ---
function init() {
  // Don't initialize if already loaded
  if (document.querySelector("openmagic-toolbar")) return;

  // Create custom element
  const host = document.createElement("openmagic-toolbar");
  host.dataset.openmagic = "true";
  shadow = host.attachShadow({ mode: "closed" });

  // Inject styles
  const style = document.createElement("style");
  style.textContent = TOOLBAR_CSS;
  shadow.appendChild(style);

  // Create container
  container = document.createElement("div");
  shadow.appendChild(container);

  // Mount
  document.body.appendChild(host);

  // Install captures
  installNetworkCapture();
  installConsoleCapture();

  // Check for updates (non-blocking)
  checkForUpdates();

  // Connect to server
  const config = (window as any).__OPENMAGIC_CONFIG__;
  if (config) {
    ws.connect(config.wsPort, config.token)
      .then(() => {
        state.connected = true;
        // Fetch config
        ws.request("config.get").then((msg: any) => {
          state.provider = msg.payload?.provider || "";
          state.model = msg.payload?.model || "";
          state.hasApiKey = msg.payload?.hasApiKey || false;
          state.roots = msg.payload?.roots || [];

          // If not configured, open settings
          if (!state.provider || !state.hasApiKey) {
            state.panelOpen = true;
            state.activePanel = "settings";
          }

          render();
        });
      })
      .catch((e: Error) => {
        console.error("[OpenMagic] Connection failed:", e);
        state.connected = false;
        render();
      });
  }

  render();
}

// --- Render ---
function render() {
  container.innerHTML = "";

  // Panel (if open)
  if (state.panelOpen && state.activePanel) {
    const panel = document.createElement("div");
    panel.className = "om-panel";

    if (state.activePanel === "settings") {
      panel.innerHTML = renderSettings();
    } else if (state.activePanel === "chat") {
      panel.innerHTML = renderChat();
    }

    container.appendChild(panel);
    attachPanelEvents(panel);
  }

  // Floating pill
  const pill = document.createElement("div");
  pill.className = "om-pill";
  pill.innerHTML = `
    <span class="om-pill-logo">✨</span>
    <span class="om-pill-text">Magic</span>
    <span class="om-pill-divider"></span>
    <button class="om-pill-btn ${state.selecting ? "active" : ""}" data-action="select" title="Select Element">
      🎯
    </button>
    <button class="om-pill-btn" data-action="screenshot" title="Screenshot">
      📸
    </button>
    <button class="om-pill-btn ${state.activePanel === "chat" ? "active" : ""}" data-action="chat" title="Chat">
      💬
    </button>
    <button class="om-pill-btn ${state.activePanel === "settings" ? "active" : ""}" data-action="settings" title="Settings">
      ⚙️
    </button>
  `;

  // Connection indicator
  if (!state.connected) {
    const dot = document.createElement("span");
    dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#e94560;margin-left:4px;";
    pill.appendChild(dot);
  }

  // Update indicator
  if (state.updateAvailable) {
    const updateDot = document.createElement("span");
    updateDot.className = "om-update-dot";
    updateDot.title = `Update available: v${state.latestVersion}`;
    updateDot.addEventListener("click", (e) => {
      e.stopPropagation();
      state.panelOpen = true;
      state.activePanel = "settings";
      render();
    });
    pill.appendChild(updateDot);
  }

  container.appendChild(pill);

  // Draggable
  makeDraggable(pill);

  // Pill button events
  pill.querySelectorAll(".om-pill-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;

      if (action === "select") {
        toggleSelectMode();
      } else if (action === "screenshot") {
        takeScreenshot();
      } else if (action === "chat") {
        togglePanel("chat");
      } else if (action === "settings") {
        togglePanel("settings");
      }
    });
  });
}

// --- Renderers ---

function renderSettings(): string {
  const providerOptions = Object.entries(MODEL_REGISTRY)
    .map(([key, p]) => `<option value="${key}" ${state.provider === key ? "selected" : ""}>${p.name}</option>`)
    .join("");

  const currentProvider = MODEL_REGISTRY[state.provider];
  const modelOptions = currentProvider
    ? currentProvider.models.map((m) =>
        `<option value="${m.id}" ${state.model === m.id ? "selected" : ""}>${m.name}</option>`
      ).join("")
    : '<option value="">Select a provider first</option>';

  const keyPlaceholder = currentProvider?.keyPlaceholder || "Enter API key...";
  const isLocal = currentProvider?.local || false;

  const updateBanner = state.updateAvailable
    ? `<div class="om-update-banner">
        <span>🚀 v${state.latestVersion} available</span>
        <span class="om-update-current">current: v${CURRENT_VERSION}</span>
        <code class="om-update-cmd">npx openmagic@latest</code>
       </div>`
    : "";

  return `
    <div class="om-panel-header">
      <span class="om-panel-title">Settings</span>
      <span class="om-panel-version">v${CURRENT_VERSION}</span>
      <button class="om-panel-close" data-action="close">&times;</button>
    </div>
    <div class="om-panel-body">
      ${updateBanner}
      <div class="om-settings">
        <div class="om-field">
          <label class="om-label">Provider</label>
          <select class="om-select" data-field="provider">
            <option value="">Select Provider...</option>
            ${providerOptions}
          </select>
        </div>

        <div class="om-field">
          <label class="om-label">Model</label>
          <select class="om-select" data-field="model">
            <option value="">Select Model...</option>
            ${modelOptions}
          </select>
        </div>

        <div class="om-field ${isLocal ? "om-hidden" : ""}">
          <label class="om-label">API Key</label>
          <input type="password" class="om-input" data-field="apiKey"
                 placeholder="${keyPlaceholder}"
                 value="" />
        </div>

        <button class="om-btn" data-action="save-settings">Save Configuration</button>

        ${state.hasApiKey ? '<div class="om-status om-status-success">API key configured</div>' : ""}
      </div>
    </div>
  `;
}

function renderChat(): string {
  if (!state.hasApiKey || !state.provider) {
    return `
      <div class="om-panel-header">
        <span class="om-panel-title">Chat</span>
        <button class="om-panel-close" data-action="close">&times;</button>
      </div>
      <div class="om-panel-body">
        <div class="om-status om-status-error">
          Configure your LLM provider in Settings first
        </div>
      </div>
    `;
  }

  const messagesHtml = state.messages
    .map((m) => `<div class="om-msg om-msg-${m.role}">${escapeHtml(m.content)}</div>`)
    .join("");

  const streamHtml = state.streaming
    ? `<div class="om-msg om-msg-assistant"><div class="om-loading"><div class="om-spinner"></div> Thinking...</div>${escapeHtml(state.streamContent)}</div>`
    : "";

  const contextChips: string[] = [];
  if (state.selectedElement) {
    contextChips.push(`<span class="om-context-chip">🎯 ${state.selectedElement.tagName}${state.selectedElement.id ? "#" + state.selectedElement.id : ""} <button class="om-context-chip-remove" data-action="clear-element">&times;</button></span>`);
  }
  if (state.screenshot) {
    contextChips.push(`<span class="om-context-chip">📸 Screenshot <button class="om-context-chip-remove" data-action="clear-screenshot">&times;</button></span>`);
  }

  return `
    <div class="om-panel-header">
      <span class="om-panel-title">Chat — ${MODEL_REGISTRY[state.provider]?.name || state.provider} / ${state.model}</span>
      <button class="om-panel-close" data-action="close">&times;</button>
    </div>
    <div class="om-panel-body">
      ${contextChips.length > 0 ? `<div class="om-context-bar">${contextChips.join("")}</div>` : ""}
      ${state.selectedElement ? `<div class="om-element-info">&lt;${state.selectedElement.tagName}${state.selectedElement.id ? ' id="' + state.selectedElement.id + '"' : ""}${state.selectedElement.className ? ' class="' + state.selectedElement.className.toString().slice(0, 60) + '"' : ""}&gt;</div>` : ""}
      <div class="om-chat-messages">
        ${messagesHtml || '<div style="color:#555;text-align:center;padding:40px 0;font-size:13px;">Select an element or describe what you want to change</div>'}
        ${streamHtml}
      </div>
      <div class="om-chat-input-wrap">
        <textarea class="om-chat-input" placeholder="Describe the change you want..."
                  rows="1" ${state.streaming ? "disabled" : ""}></textarea>
        <button class="om-chat-send" data-action="send" ${state.streaming ? "disabled" : ""}>
          ${state.streaming ? "..." : "Send"}
        </button>
      </div>
    </div>
  `;
}

// --- Event Handlers ---

function attachPanelEvents(panel: HTMLElement) {
  // Close button
  panel.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    state.panelOpen = false;
    state.activePanel = null;
    render();
  });

  // Settings: provider change
  panel.querySelector('[data-field="provider"]')?.addEventListener("change", (e) => {
    state.provider = (e.target as HTMLSelectElement).value;
    state.model = "";
    render();
  });

  // Settings: model change
  panel.querySelector('[data-field="model"]')?.addEventListener("change", (e) => {
    state.model = (e.target as HTMLSelectElement).value;
  });

  // Settings: save
  panel.querySelector('[data-action="save-settings"]')?.addEventListener("click", () => {
    const apiKeyInput = panel.querySelector('[data-field="apiKey"]') as HTMLInputElement;
    const apiKey = apiKeyInput?.value || "";

    const payload: any = {
      provider: state.provider,
      model: state.model,
    };
    if (apiKey) {
      payload.apiKey = apiKey;
    }

    ws.request("config.set", payload).then(() => {
      state.hasApiKey = true;
      render();
    }).catch((e: Error) => {
      console.error("[OpenMagic] Failed to save config:", e);
    });
  });

  // Chat: send
  panel.querySelector('[data-action="send"]')?.addEventListener("click", () => {
    sendMessage(panel);
  });

  // Chat: enter to send
  const input = panel.querySelector(".om-chat-input") as HTMLTextAreaElement;
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(panel);
    }
  });

  // Auto-resize textarea
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  // Clear context
  panel.querySelector('[data-action="clear-element"]')?.addEventListener("click", () => {
    state.selectedElement = null;
    render();
  });

  panel.querySelector('[data-action="clear-screenshot"]')?.addEventListener("click", () => {
    state.screenshot = null;
    render();
  });
}

async function sendMessage(panel: HTMLElement) {
  const input = panel.querySelector(".om-chat-input") as HTMLTextAreaElement;
  if (!input) return;

  const text = input.value.trim();
  if (!text || state.streaming) return;

  // Add user message
  state.messages.push({ role: "user", content: text });
  state.streaming = true;
  state.streamContent = "";
  render();

  // Build context
  const context = buildContext(state.selectedElement, state.screenshot);

  try {
    const result = await ws.stream(
      "llm.chat",
      {
        provider: state.provider,
        model: state.model,
        messages: state.messages.map((m) => ({ role: m.role, content: m.content })),
        context,
      },
      (chunk: string) => {
        state.streamContent += chunk;
        // Update streaming message in place
        const msgContainer = shadow.querySelector(".om-chat-messages");
        const streamEl = msgContainer?.querySelector(".om-msg-assistant:last-child");
        if (streamEl) {
          streamEl.innerHTML = escapeHtml(state.streamContent);
        }
      }
    );

    // Add assistant message
    state.messages.push({ role: "assistant", content: state.streamContent || result?.content || "" });

    // Handle modifications
    if (result?.modifications && result.modifications.length > 0) {
      for (const mod of result.modifications) {
        if (mod.type === "edit" && mod.file && mod.search && mod.replace) {
          // Read the file first
          try {
            const fileResult = await ws.request("fs.read", { path: resolveFilePath(mod.file) });
            const content = fileResult.payload?.content;
            if (content && content.includes(mod.search)) {
              const newContent = content.replace(mod.search, mod.replace);
              await ws.request("fs.write", { path: resolveFilePath(mod.file), content: newContent });
              state.messages.push({
                role: "system",
                content: `Applied change to ${mod.file}`,
              });
            }
          } catch (e: any) {
            state.messages.push({
              role: "system",
              content: `Failed to apply change to ${mod.file}: ${e.message}`,
            });
          }
        }
      }
    }
  } catch (e: any) {
    state.messages.push({ role: "system", content: `Error: ${e.message}` });
  }

  state.streaming = false;
  state.streamContent = "";
  render();
}

function resolveFilePath(relativePath: string): string {
  // Resolve relative to first root
  if (state.roots.length > 0) {
    return state.roots[0] + "/" + relativePath;
  }
  return relativePath;
}

// --- Select Mode ---

let selectHandler: ((e: MouseEvent) => void) | null = null;
let hoverHandler: ((e: MouseEvent) => void) | null = null;

function toggleSelectMode() {
  if (state.selecting) {
    exitSelectMode();
  } else {
    enterSelectMode();
  }
}

function enterSelectMode() {
  state.selecting = true;
  document.body.style.cursor = "crosshair";

  hoverHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (isOpenMagicElement(target)) return;
    const rect = target.getBoundingClientRect();
    showHighlight({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  };

  selectHandler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (isOpenMagicElement(target)) return;

    state.selectedElement = inspectElement(target);
    exitSelectMode();

    // Open chat if not open
    if (state.activePanel !== "chat") {
      state.panelOpen = true;
      state.activePanel = "chat";
    }

    render();
  };

  document.addEventListener("mousemove", hoverHandler, true);
  document.addEventListener("click", selectHandler, true);

  render();
}

function exitSelectMode() {
  state.selecting = false;
  document.body.style.cursor = "";
  hideHighlight();

  if (hoverHandler) {
    document.removeEventListener("mousemove", hoverHandler, true);
    hoverHandler = null;
  }
  if (selectHandler) {
    document.removeEventListener("click", selectHandler, true);
    selectHandler = null;
  }

  render();
}

// --- Screenshot ---

async function takeScreenshot() {
  const screenshot = await captureScreenshot();
  if (screenshot) {
    state.screenshot = screenshot;
    // Open chat
    state.panelOpen = true;
    state.activePanel = "chat";
    render();
  }
}

// --- Panel Toggle ---

function togglePanel(panel: "chat" | "settings") {
  if (state.panelOpen && state.activePanel === panel) {
    state.panelOpen = false;
    state.activePanel = null;
  } else {
    state.panelOpen = true;
    state.activePanel = panel;
  }
  render();
}

// --- Draggable ---

function makeDraggable(el: HTMLElement) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  el.addEventListener("mousedown", (e) => {
    // Only drag from the pill itself, not buttons
    if ((e.target as HTMLElement).closest(".om-pill-btn")) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.position = "fixed";
    el.style.left = origX + dx + "px";
    el.style.top = origY + dy + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

// --- Helpers ---

function isOpenMagicElement(el: HTMLElement): boolean {
  return !!el.closest("openmagic-toolbar") || !!el.dataset?.openmagic;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Update Check ---

function checkForUpdates(): void {
  // Query npm registry for latest version (non-blocking, silent fail)
  fetch("https://registry.npmjs.org/openmagic/latest", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (!res.ok) return;
      return res.json();
    })
    .then((data) => {
      if (!data?.version) return;
      const latest = data.version;
      if (isNewerVersion(latest, CURRENT_VERSION)) {
        state.updateAvailable = true;
        state.latestVersion = latest;
        render();
      }
    })
    .catch(() => {
      // Silently ignore — update check is best-effort
    });
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

// --- Boot ---
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
