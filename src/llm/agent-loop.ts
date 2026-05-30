import type { CodeModification } from "../shared-types.js";

/**
 * H12: the investigate→edit loop, server-side. The browser sendPrompt while-loop
 * (read files / search / retry until the model proposes edits) is reimplemented
 * here as a bounded, dependency-injected state machine so it can be tested in
 * isolation, driven by an `agent.run` op, and reused across providers. Deps are
 * injected (the model `step`, sandboxed `readFile`/`search`) — the loop itself is
 * pure control flow.
 */

export interface AgentContextFile {
  path: string;
  content: string;
}

export interface AgentContext {
  files: AgentContextFile[];
  searchResults: Array<{ query: string; result: string }>;
}

export interface AgentTurn {
  text: string;
  modifications: CodeModification[]; // non-empty ⇒ the model has finalized edits
  needFiles: string[];               // files the model asked to read
  searchQueries: string[];           // codebase searches the model requested
}

export type AgentEvent =
  | { type: "step"; n: number }
  | { type: "investigate"; files: string[]; searches: string[] }
  | { type: "done"; modifications: number }
  | { type: "exhausted" };

export interface AgentLoopDeps {
  step: (ctx: AgentContext) => Promise<AgentTurn>;
  readFile: (path: string) => Promise<string | null>;
  search: (query: string) => Promise<string>;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  content: string;
  modifications: CodeModification[];
  steps: number;
}

/** Parse NEED_FILE / SEARCH_FILES directives out of a model response (server-side
 *  equivalent of the toolbar's retry-loop regexes). */
export function extractAgentDirectives(text: string): { needFiles: string[]; searchQueries: string[] } {
  const needFiles: string[] = [];
  const searchQueries: string[] = [];
  for (const m of text.matchAll(/NEED_FILE:\s*"?([^\s"}\]]+)"?/g)) needFiles.push(m[1].trim());
  for (const m of text.matchAll(/SEARCH_FILES:\s*"([^"]+)"/g)) searchQueries.push(m[1].trim());
  return { needFiles, searchQueries };
}

export async function runAgentLoop(
  deps: AgentLoopDeps,
  opts: { maxSteps: number; signal?: AbortSignal }
): Promise<AgentResult> {
  const ctx: AgentContext = { files: [], searchResults: [] };
  const readPaths = new Set<string>();
  const searched = new Set<string>();
  const emit = (e: AgentEvent) => deps.onEvent?.(e);

  for (let step = 1; step <= opts.maxSteps; step++) {
    if (opts.signal?.aborted) return { content: "", modifications: [], steps: step - 1 };
    emit({ type: "step", n: step });

    const turn = await deps.step(ctx);

    if (turn.modifications.length > 0) {
      emit({ type: "done", modifications: turn.modifications.length });
      return { content: turn.text, modifications: turn.modifications, steps: step };
    }

    // Investigate: pull in any newly-requested files / run new searches.
    let progressed = false;
    const newFiles: string[] = [];
    for (const path of turn.needFiles) {
      const key = path.trim();
      if (!key || readPaths.has(key)) continue;
      readPaths.add(key);
      const content = await deps.readFile(key);
      if (content != null) {
        ctx.files.push({ path: key, content });
        newFiles.push(key);
        progressed = true;
      }
    }
    const newSearches: string[] = [];
    for (const query of turn.searchQueries) {
      const key = query.trim();
      if (!key || searched.has(key)) continue;
      searched.add(key);
      const result = await deps.search(key);
      ctx.searchResults.push({ query: key, result });
      newSearches.push(key);
      progressed = true;
    }

    if (newFiles.length || newSearches.length) {
      emit({ type: "investigate", files: newFiles, searches: newSearches });
    }

    // No edits and nothing new to feed back — the model can't make progress.
    if (!progressed) {
      emit({ type: "done", modifications: 0 });
      return { content: turn.text, modifications: [], steps: step };
    }
  }

  emit({ type: "exhausted" });
  return { content: "Reached the step budget without finalizing an edit.", modifications: [], steps: opts.maxSteps };
}
