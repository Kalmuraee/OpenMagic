export const TOOLBAR_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #e0e0e0;
  line-height: 1.5;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
.om-hidden { display: none !important; }

/* ── Unified Toolbar Container ────────────────────────── */
.om-toolbar {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  width: min(420px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  background: #111125;
  border: 1px solid rgba(108, 92, 231, 0.18);
  border-radius: 14px;
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.02);
  overflow: hidden;
}

/* Panel header */
.om-panel-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  background: rgba(108, 92, 231, 0.03);
  flex-shrink: 0;
}
.om-panel-title { font-size: 11px; font-weight: 600; color: #a29bfe; }
.om-panel-version { font-size: 10px; color: #444; margin-left: auto; }
.om-panel-close {
  background: none; border: none; color: #555; cursor: pointer;
  padding: 2px 4px; border-radius: 4px; line-height: 1;
  display: flex; align-items: center;
}
.om-panel-close:hover { color: #ccc; background: rgba(255,255,255,0.05); }

/* ── Header Bar (brand + tools) ───────────────────────── */
.om-toolbar-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px 6px 5px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  background: rgba(108, 92, 231, 0.03);
  flex-shrink: 0;
}

.om-grab {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 26px; color: #3a3a5a; cursor: grab;
  border-radius: 5px; transition: color 0.15s; flex-shrink: 0;
}
.om-grab:hover { color: #6c5ce7; }
.om-grab:active { cursor: grabbing; color: #a29bfe; }

.om-pill-brand {
  display: flex; align-items: center; gap: 5px;
  padding: 0 6px 0 4px; cursor: grab;
}
.om-pill-icon { color: #a29bfe; flex-shrink: 0; }
.om-pill-text { font-size: 11px; font-weight: 700; color: #a29bfe; letter-spacing: 0.3px; white-space: nowrap; }

.om-pill-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.06); margin: 0 3px; flex-shrink: 0; }

.om-pill-btn {
  background: none; border: none; color: #555; cursor: pointer;
  padding: 5px 6px; border-radius: 6px; line-height: 1;
  transition: background 0.15s, color 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.om-pill-btn:hover { background: rgba(108, 92, 231, 0.15); color: #a29bfe; }
.om-pill-btn.active { background: rgba(108, 92, 231, 0.25); color: #c4b5fd; }

.om-status-dot {
  width: 7px; height: 7px; border-radius: 50%; margin-left: auto; flex-shrink: 0;
}
.om-status-dot.connected { background: #00b894; }
.om-status-dot.disconnected { background: #e94560; }

.om-update-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #fdcb6e;
  margin-left: 4px; cursor: pointer; flex-shrink: 0;
  animation: om-pulse 2s ease infinite;
}
@keyframes om-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(253,203,110,0.4); }
  50% { box-shadow: 0 0 0 5px rgba(253,203,110,0); }
}

/* ── Panel (expandable area between header and prompt) ── */
.om-panel {
  max-height: 420px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  animation: om-expand 0.15s ease;
}
@keyframes om-expand {
  from { max-height: 0; opacity: 0; }
  to { max-height: 420px; opacity: 1; }
}

.om-panel-body {
  overflow-y: auto; padding: 12px;
  max-height: 420px;
}
.om-panel-body::-webkit-scrollbar { width: 5px; }
.om-panel-body::-webkit-scrollbar-track { background: transparent; }
.om-panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }

/* ── Prompt Row (always visible at bottom) ────────────── */
.om-prompt-row {
  display: flex;
  align-items: center;
  padding: 6px;
  gap: 4px;
  flex-shrink: 0;
}

.om-prompt-context {
  display: flex; gap: 3px; flex-shrink: 0;
}
.om-prompt-chip {
  display: flex; align-items: center; gap: 3px;
  padding: 3px 7px; background: rgba(108, 92, 231, 0.08);
  border: 1px solid rgba(108, 92, 231, 0.12);
  border-radius: 6px; font-size: 10px; color: #a29bfe;
  cursor: default; white-space: nowrap;
}
.om-prompt-chip-x {
  background: none; border: none; color: #a29bfe; cursor: pointer;
  font-size: 11px; line-height: 1; padding: 0 1px; opacity: 0.5;
}
.om-prompt-chip-x:hover { opacity: 1; }

.om-prompt-input {
  flex: 1;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  padding: 7px 10px;
  outline: none;
  min-width: 0;
  transition: border-color 0.15s;
}
.om-prompt-input:focus { border-color: rgba(108, 92, 231, 0.4); }
.om-prompt-input::placeholder { color: #3a3a5a; }

.om-prompt-send {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; flex-shrink: 0;
  background: #6c5ce7; border: none; border-radius: 8px;
  color: white; cursor: pointer; transition: background 0.15s;
}
.om-prompt-send:hover { background: #7c6cf7; }
.om-prompt-send:disabled { background: #2a2a4a; color: #444; cursor: not-allowed; }

/* ── Settings ─────────────────────────────────────────── */
.om-settings { display: flex; flex-direction: column; gap: 12px; }

.om-field { display: flex; flex-direction: column; gap: 5px; }
.om-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }

.om-select, .om-input {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 8px 10px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
}
.om-select:focus, .om-input:focus { border-color: rgba(108, 92, 231, 0.4); }
.om-select option { background: #111125; color: #e0e0e0; }

.om-key-row { display: flex; gap: 6px; align-items: stretch; }
.om-key-input { flex: 1; min-width: 0; -webkit-text-security: disc; }

.om-btn-get-key {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 9px; background: rgba(108, 92, 231, 0.08);
  border: 1px solid rgba(108, 92, 231, 0.15); border-radius: 8px;
  color: #a29bfe; font-size: 11px; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap;
  transition: all 0.15s;
}
.om-btn-get-key:hover { background: rgba(108, 92, 231, 0.15); color: #c4b5fd; }

.om-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  background: #6c5ce7; border: none; color: white; cursor: pointer;
  padding: 8px 14px; border-radius: 8px;
  font-size: 13px; font-weight: 600; font-family: inherit;
  transition: background 0.15s;
}
.om-btn:hover { background: #7c6cf7; }
.om-btn:disabled { background: #2a2a4a; color: #555; cursor: not-allowed; }
.om-btn-saving { background: #4a3db0; }
.om-btn-saved { background: #00b894; }

.om-status { font-size: 11px; padding: 5px 8px; border-radius: 6px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 4px; }
.om-status-success { background: rgba(0, 184, 148, 0.06); color: #00b894; }
.om-status-error { background: rgba(233, 69, 96, 0.06); color: #e94560; }

.om-key-hint { font-size: 10px; color: #444; margin-top: 3px; }
.om-key-hint a { color: #7c6cf7; cursor: pointer; text-decoration: none; }
.om-key-hint a:hover { text-decoration: underline; }

.om-update-banner {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 7px 10px; margin-bottom: 10px;
  background: rgba(253, 203, 110, 0.04); border: 1px solid rgba(253, 203, 110, 0.12);
  border-radius: 8px; font-size: 11px; color: #fdcb6e;
}
.om-update-cmd {
  display: block; width: 100%; margin-top: 2px;
  padding: 4px 7px; background: rgba(0, 0, 0, 0.12); border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 11px; color: #fdcb6e; user-select: all;
}

/* ── Chat ─────────────────────────────────────────────── */
.om-chat-messages {
  display: flex; flex-direction: column; gap: 8px;
  max-height: 380px;
  overflow-y: auto;
}
.om-chat-messages::-webkit-scrollbar { width: 4px; }
.om-chat-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }

.om-msg {
  padding: 8px 11px; border-radius: 10px;
  font-size: 13px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
}
.om-msg-user { background: rgba(108, 92, 231, 0.08); color: #ccc; margin-left: 36px; border-bottom-right-radius: 3px; }
.om-msg-assistant { background: rgba(255,255,255,0.02); color: #aaa; margin-right: 36px; border-bottom-left-radius: 3px; border: 1px solid rgba(255,255,255,0.03); }
.om-msg-system { background: rgba(108, 92, 231, 0.05); color: #888; font-size: 11px; text-align: center; padding: 5px 8px; border-radius: 6px; }

.om-chat-empty { color: #333; text-align: center; padding: 32px 16px; font-size: 12px; line-height: 1.6; }

.om-spinner { width: 12px; height: 12px; border: 2px solid rgba(108,92,231,0.12); border-top-color: #6c5ce7; border-radius: 50%; animation: om-spin 0.6s linear infinite; display: inline-block; vertical-align: -1px; margin-right: 5px; }
@keyframes om-spin { to { transform: rotate(360deg); } }

.om-element-info {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.03);
  border-radius: 6px; padding: 6px 8px;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 10px; color: #555; max-height: 60px; overflow-y: auto; margin-bottom: 6px;
}
`;
