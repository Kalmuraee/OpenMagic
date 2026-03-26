// CSS as a JS string so it can be injected into Shadow DOM
export const TOOLBAR_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #e0e0e0;
  line-height: 1.5;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Floating Pill */
.om-pill {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 1px solid rgba(108, 92, 231, 0.3);
  border-radius: 50px;
  cursor: grab;
  user-select: none;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(108, 92, 231, 0.1);
  transition: box-shadow 0.2s, transform 0.2s;
}

.om-pill:hover {
  box-shadow: 0 6px 32px rgba(108, 92, 231, 0.3), 0 0 0 1px rgba(108, 92, 231, 0.3);
  transform: translateY(-1px);
}

.om-pill:active {
  cursor: grabbing;
}

.om-pill-logo {
  font-size: 18px;
  line-height: 1;
}

.om-pill-text {
  font-size: 12px;
  font-weight: 600;
  color: #a29bfe;
  letter-spacing: 0.5px;
}

.om-pill-btn {
  background: none;
  border: none;
  color: #e0e0e0;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  transition: background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.om-pill-btn:hover {
  background: rgba(108, 92, 231, 0.2);
}

.om-pill-btn.active {
  background: rgba(108, 92, 231, 0.3);
  color: #a29bfe;
}

.om-pill-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
}

/* Panel */
.om-panel {
  position: fixed;
  bottom: 80px;
  right: 24px;
  z-index: 2147483647;
  width: 420px;
  max-height: 600px;
  background: #1a1a2e;
  border: 1px solid rgba(108, 92, 231, 0.2);
  border-radius: 16px;
  box-shadow: 0 8px 48px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: om-slide-up 0.2s ease;
}

@keyframes om-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.om-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(108, 92, 231, 0.05);
}

.om-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #a29bfe;
}

.om-panel-close {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 18px;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.om-panel-close:hover {
  color: #e0e0e0;
  background: rgba(255, 255, 255, 0.05);
}

.om-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.om-panel-body::-webkit-scrollbar {
  width: 6px;
}

.om-panel-body::-webkit-scrollbar-track {
  background: transparent;
}

.om-panel-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

/* Chat */
.om-chat-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
  max-height: 380px;
  overflow-y: auto;
  padding-bottom: 8px;
}

.om-chat-messages::-webkit-scrollbar {
  width: 4px;
}

.om-chat-messages::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.om-msg {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.om-msg-user {
  background: rgba(108, 92, 231, 0.15);
  color: #e0e0e0;
  margin-left: 32px;
  border-bottom-right-radius: 4px;
}

.om-msg-assistant {
  background: rgba(255, 255, 255, 0.03);
  color: #ccc;
  margin-right: 32px;
  border-bottom-left-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.om-msg-system {
  background: rgba(233, 69, 96, 0.1);
  color: #e94560;
  font-size: 12px;
  text-align: center;
  padding: 8px;
}

.om-chat-input-wrap {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.om-chat-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 10px 14px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  resize: none;
  min-height: 40px;
  max-height: 120px;
}

.om-chat-input:focus {
  border-color: rgba(108, 92, 231, 0.5);
}

.om-chat-input::placeholder {
  color: #555;
}

.om-chat-send {
  background: #6c5ce7;
  border: none;
  color: white;
  cursor: pointer;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  transition: background 0.15s;
  white-space: nowrap;
}

.om-chat-send:hover {
  background: #7c6cf7;
}

.om-chat-send:disabled {
  background: #333;
  color: #666;
  cursor: not-allowed;
}

/* Settings */
.om-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.om-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.om-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
}

.om-select, .om-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px 12px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  width: 100%;
}

.om-select:focus, .om-input:focus {
  border-color: rgba(108, 92, 231, 0.5);
}

.om-select option {
  background: #1a1a2e;
  color: #e0e0e0;
}

.om-btn {
  background: #6c5ce7;
  border: none;
  color: white;
  cursor: pointer;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  transition: background 0.15s;
}

.om-btn:hover {
  background: #7c6cf7;
}

.om-btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.om-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

.om-status {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  text-align: center;
}

.om-status-success {
  background: rgba(0, 184, 148, 0.1);
  color: #00b894;
}

.om-status-error {
  background: rgba(233, 69, 96, 0.1);
  color: #e94560;
}

/* Context bar */
.om-context-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.om-context-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(108, 92, 231, 0.1);
  border: 1px solid rgba(108, 92, 231, 0.2);
  border-radius: 20px;
  font-size: 11px;
  color: #a29bfe;
}

.om-context-chip-remove {
  background: none;
  border: none;
  color: #a29bfe;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}

/* Diff */
.om-diff {
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin: 8px 0;
}

.om-diff-header {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: #888;
  font-size: 11px;
}

.om-diff-line {
  padding: 2px 12px;
  white-space: pre;
  overflow-x: auto;
}

.om-diff-add {
  background: rgba(0, 184, 148, 0.1);
  color: #55efc4;
}

.om-diff-remove {
  background: rgba(233, 69, 96, 0.1);
  color: #fab1a0;
}

.om-diff-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
}

/* Element info */
.om-element-info {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 10px 12px;
  font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  color: #888;
  margin: 8px 0;
  max-height: 100px;
  overflow-y: auto;
}

.om-hidden {
  display: none !important;
}

/* Loading */
.om-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  color: #888;
  font-size: 12px;
}

.om-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(108, 92, 231, 0.2);
  border-top-color: #6c5ce7;
  border-radius: 50%;
  animation: om-spin 0.6s linear infinite;
}

@keyframes om-spin {
  to { transform: rotate(360deg); }
}

/* Tooltip */
.om-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a2e;
  color: #e0e0e0;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  margin-bottom: 4px;
}

.om-pill-btn:hover .om-tooltip {
  opacity: 1;
}
`;
