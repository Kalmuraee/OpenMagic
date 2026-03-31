// ============================================================
// OpenMagic — Shared Types & Protocol
// ============================================================

// --- WebSocket Protocol Messages ---

export interface WsMessage {
  id: string;
  type: string;
  payload?: unknown;
}

// Toolbar → Server
export type ClientMessageType =
  | "handshake"
  | "fs.read"
  | "fs.write"
  | "fs.list"
  | "llm.chat"
  | "config.get"
  | "config.set";

export interface HandshakePayload {
  token: string;
}

export interface FsReadPayload {
  path: string;
}

export interface FsWritePayload {
  path: string;
  content: string;
}

export interface FsListPayload {
  root?: string;
  pattern?: string;
}

export interface LlmChatPayload {
  provider: string;
  model: string;
  messages: ChatMessage[];
  context: LlmContext;
}

export interface ConfigSetPayload {
  provider?: string;
  model?: string;
  apiKey?: string;
  roots?: string[];
}

// Server → Toolbar
export type ServerMessageType =
  | "handshake.ok"
  | "fs.content"
  | "fs.written"
  | "fs.tree"
  | "llm.chunk"
  | "llm.done"
  | "llm.error"
  | "error";

// --- Chat & LLM Types ---

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmContext {
  selectedElement?: ElementInfo;
  screenshot?: string; // base64 data URL
  networkLogs?: NetworkLogEntry[];
  consoleLogs?: ConsoleLogEntry[];
  files?: FileContext[];
  projectTree?: string;
}

export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  outerHTML: string;
  computedStyles?: Record<string, string>;
  boundingRect?: DOMRect;
  xpath?: string;
  cssSelector?: string;
}

export interface NetworkLogEntry {
  method: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  duration?: number;
  timestamp: number;
}

export interface ConsoleLogEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  args: string[];
  timestamp: number;
}

export interface FileContext {
  path: string;
  content: string;
}

// --- Code Modification ---

export interface CodeModification {
  file: string;
  type: "edit" | "create" | "delete";
  search?: string;
  replace?: string;
  content?: string; // for create
  explanation?: string;
}

export interface LlmResponse {
  modifications: CodeModification[];
  explanation: string;
}

// --- Config ---

export interface OpenMagicConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  apiKeys?: Record<string, string>; // per-provider key storage
  roots: string[];
  proxyPort: number;
  targetPort: number;
}

// --- File Tree ---

export interface FileEntry {
  path: string;
  type: "file" | "dir";
  name: string;
}

// --- Provider Registry ---

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";

export interface ThinkingConfig {
  supported: boolean;
  paramName: string;       // e.g., "reasoning.effort", "thinking.budget_tokens", "thinking_level"
  paramType: "level" | "budget"; // "level" = enum string, "budget" = token count
  levels?: ThinkingLevel[];
  defaultLevel?: ThinkingLevel;
  defaultBudget?: number;  // default budget_tokens if paramType is "budget"
  maxBudget?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  vision: boolean;
  context: number;
  maxOutput: number;
  thinking?: ThinkingConfig;
}

export interface ProviderInfo {
  name: string;
  models: ModelInfo[];
  apiBase: string;
  keyPrefix: string;
  keyPlaceholder: string;
  local?: boolean;
}

export type ProviderRegistry = Record<string, ProviderInfo>;
