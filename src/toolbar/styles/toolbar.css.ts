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

/* ── Pill Bar ─────────────────────────────────────────── */
.om-pill {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 10px 5px 4px;
  background: linear-gradient(135deg, #111125 0%, #191938 100%);
  border: 1px solid rgba(108, 92, 231, 0.2);
  border-radius: 12px;
  user-select: none;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.03);
  transition: box-shadow 0.2s;
}
.om-pill:hover { box-shadow: 0 6px 28px rgba(108, 92, 231, 0.2), inset 0 1px 0 rgba(255,255,255,0.03); }

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

.om-pill-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.07); margin: 0 3px; }

.om-pill-btn {
  background: none; border: none; color: #555; cursor: pointer;
  padding: 5px 6px; border-radius: 6px; line-height: 1;
  transition: background 0.15s, color 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.om-pill-btn:hover { background: rgba(108, 92, 231, 0.15); color: #a29bfe; }
.om-pill-btn.active { background: rgba(108, 92, 231, 0.25); color: #c4b5fd; }

.om-status-dot {
  width: 7px; height: 7px; border-radius: 50%; margin-left: 4px; flex-shrink: 0;
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

/* ── Prompt Bar (always visible) ──────────────────────── */
.om-prompt-bar {
  position: fixed;
  bottom: 62px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  width: 420px;
  background: #151528;
  border: 1px solid rgba(108, 92, 231, 0.15);
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.om-prompt-bar:focus-within {
  border-color: rgba(108, 92, 231, 0.4);
  box-shadow: 0 4px 24px rgba(108, 92, 231, 0.15);
}

.om-prompt-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  padding: 8px 12px;
  outline: none;
  min-width: 0;
}
.om-prompt-input::placeholder { color: #444; }

.om-prompt-context {
  display: flex; gap: 3px; padding: 0 4px; flex-shrink: 0;
}
.om-prompt-chip {
  display: flex; align-items: center; gap: 3px;
  padding: 3px 7px; background: rgba(108, 92, 231, 0.1);
  border: 1px solid rgba(108, 92, 231, 0.15);
  border-radius: 6px; font-size: 10px; color: #a29bfe;
  cursor: default; white-space: nowrap;
}
.om-prompt-chip-x {
  background: none; border: none; color: #a29bfe; cursor: pointer;
  font-size: 12px; line-height: 1; padding: 0 1px; opacity: 0.6;
}
.om-prompt-chip-x:hover { opacity: 1; }

.om-prompt-send {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex-shrink: 0;
  background: #6c5ce7; border: none; border-radius: 8px;
  color: white; cursor: pointer; transition: background 0.15s;
}
.om-prompt-send:hover { background: #7c6cf7; }
.om-prompt-send:disabled { background: #2a2a4a; color: #555; cursor: not-allowed; }

/* ── Panel ────────────────────────────────────────────── */
.om-panel {
  position: fixed;
  bottom: 110px;
  right: 24px;
  z-index: 2147483647;
  width: 420px;
  max-height: 520px;
  background: #151528;
  border: 1px solid rgba(108, 92, 231, 0.15);
  border-radius: 14px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: om-slide-up 0.15s ease;
}
@keyframes om-slide-up {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.om-panel-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  background: rgba(108, 92, 231, 0.03);
}
.om-panel-title { font-size: 12px; font-weight: 600; color: #a29bfe; }
.om-panel-version { font-size: 10px; color: #444; margin-left: auto; }
.om-panel-close {
  background: none; border: none; color: #555; cursor: pointer;
  padding: 2px 5px; border-radius: 4px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
}
.om-panel-close:hover { color: #ccc; background: rgba(255,255,255,0.05); }

.om-panel-body {
  flex: 1; overflow-y: auto; padding: 14px;
}
.om-panel-body::-webkit-scrollbar { width: 5px; }
.om-panel-body::-webkit-scrollbar-track { background: transparent; }
.om-panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }

/* ── Settings ─────────────────────────────────────────── */
.om-settings { display: flex; flex-direction: column; gap: 14px; }

.om-field { display: flex; flex-direction: column; gap: 5px; }
.om-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }

.om-select, .om-input {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 9px 11px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
}
.om-select:focus, .om-input:focus { border-color: rgba(108, 92, 231, 0.4); }
.om-select option { background: #151528; color: #e0e0e0; }

.om-key-row { display: flex; gap: 6px; align-items: stretch; }
.om-key-input { flex: 1; min-width: 0; -webkit-text-security: disc; }

.om-btn-get-key {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 10px; background: rgba(108, 92, 231, 0.1);
  border: 1px solid rgba(108, 92, 231, 0.2); border-radius: 8px;
  color: #a29bfe; font-size: 11px; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap;
  transition: all 0.15s;
}
.om-btn-get-key:hover { background: rgba(108, 92, 231, 0.18); color: #c4b5fd; }

.om-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  background: #6c5ce7; border: none; color: white; cursor: pointer;
  padding: 9px 16px; border-radius: 8px;
  font-size: 13px; font-weight: 600; font-family: inherit;
  transition: background 0.15s;
}
.om-btn:hover { background: #7c6cf7; }
.om-btn:disabled { background: #2a2a4a; color: #555; cursor: not-allowed; }

.om-btn-saving { background: #4a3db0; }
.om-btn-saved { background: #00b894; }

.om-status { font-size: 11px; padding: 6px 10px; border-radius: 6px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 5px; }
.om-status-success { background: rgba(0, 184, 148, 0.08); color: #00b894; }
.om-status-error { background: rgba(233, 69, 96, 0.08); color: #e94560; }

.om-key-hint { font-size: 10px; color: #555; margin-top: 4px; line-height: 1.4; }
.om-key-hint a { color: #7c6cf7; cursor: pointer; text-decoration: none; }
.om-key-hint a:hover { text-decoration: underline; }

.om-update-banner {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 12px; margin-bottom: 12px;
  background: rgba(253, 203, 110, 0.06); border: 1px solid rgba(253, 203, 110, 0.15);
  border-radius: 8px; font-size: 12px; color: #fdcb6e;
}
.om-update-cmd {
  display: block; width: 100%; margin-top: 3px;
  padding: 5px 8px; background: rgba(0, 0, 0, 0.15); border-radius: 5px;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 11px; color: #fdcb6e; user-select: all;
}

/* ── Chat ─────────────────────────────────────────────── */
.om-chat-messages {
  display: flex; flex-direction: column; gap: 10px;
  min-height: 120px; max-height: 400px;
  overflow-y: auto; padding-bottom: 6px;
}
.om-chat-messages::-webkit-scrollbar { width: 4px; }
.om-chat-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

.om-msg {
  padding: 9px 12px; border-radius: 10px;
  font-size: 13px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
}
.om-msg-user { background: rgba(108, 92, 231, 0.1); color: #d0d0d0; margin-left: 40px; border-bottom-right-radius: 3px; }
.om-msg-assistant { background: rgba(255,255,255,0.02); color: #bbb; margin-right: 40px; border-bottom-left-radius: 3px; border: 1px solid rgba(255,255,255,0.04); }
.om-msg-system { background: rgba(108, 92, 231, 0.06); color: #a29bfe; font-size: 11px; text-align: center; padding: 6px 8px; border-radius: 6px; }

.om-chat-empty { color: #3a3a5a; text-align: center; padding: 40px 20px; font-size: 13px; line-height: 1.6; }

.om-spinner { width: 14px; height: 14px; border: 2px solid rgba(108,92,231,0.15); border-top-color: #6c5ce7; border-radius: 50%; animation: om-spin 0.6s linear infinite; display: inline-block; vertical-align: -2px; margin-right: 6px; }
@keyframes om-spin { to { transform: rotate(360deg); } }

/* ── Element info ─────────────────────────────────────── */
.om-element-info {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
  border-radius: 6px; padding: 8px 10px;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 10px; color: #666; max-height: 80px; overflow-y: auto; margin-bottom: 8px;
}
`;
