# OpenMagic Harness Upgrade Plan

> Companion to `ROADMAP.md`. Where ROADMAP.md hardens the *robustness* of the current one-shot
> loop, this document rethinks the **agent harness** — the orchestration architecture that turns a
> user intent into a *verified, applied* code change. Produced from a full subsystem map +
> adversarial design review of the codebase (every claim below was checked against the source).

## Thesis

OpenMagic is a **one-shot-then-iterate** tool, not an agentic loop: a single grounded prompt
produces a JSON `modifications` blob, the server fuzzy-applies search/replace, and the loop ends at
`window.location.reload()` with **zero verification**. The single core limitation is the **open
loop** — nothing checks that an applied edit compiled, parsed, or didn't white-screen the app, so a
wrong edit is reported as "Applied" success and the model never learns. Three structural problems
compound it:

1. **CLI agents are forced through the JSON-diff contract.** Claude Code / Codex / Gemini are
   *themselves* full, verify-capable agentic harnesses (spawned with `--max-turns 5` / `--full-auto`
   / `--yolo`). OpenMagic pipes them `SYSTEM_PROMPT` (the "JSON only" contract) and then re-applies
   their output with a lossy fuzzy matcher — a contradictory **double-apply** that discards their
   core competency. (`claude-code.ts:69`, `codex-cli.ts`, `gemini-cli.ts`)
2. **Feedback that could close the loop is thrown away.** Rejections and patch-failure reasons are
   pushed as `role:system` messages and **silently dropped by all three API adapters**
   (`openai.ts:52`, `anthropic.ts:26`, `google.ts:25`); CLI adapters keep only the last user
   message. Meanwhile base64 UI sentinels (`__DIFF__`, `__APPLIED__`, …) pollute the prompt
   verbatim (`index.ts:1909`).
3. **A failed search-match dead-ends** with a chat message instead of re-prompting the model
   (`applyDiff` at `index.ts:554-622`, apply-all at `809-862`).

The target is a **server-side agent loop** with two *honest native paths* — tool-calling for API
providers, native-edit-plus-capture for CLI agents — converging on a **verification gate** that
feeds failures back as a bounded self-correction turn, with cancellation and durable rollback
underneath.

## Current harness assessment

**Maturity:** A robust one-shot prompt-and-fuzzy-apply tool with brittle string-scraping iteration —
solid plumbing, but not a closed agentic loop; well below Aider / Cursor / Claude Code, which all
verify and self-correct.

**Strengths to build on (not rewrite):**

- Single-port reverse-proxy + WebSocket `{id,type,payload}` protocol extends additively — new ops
  (`verify`, `cancel`, `agent.*`) are not rewrites.
- The patch layer is **already partly transactional**: `planPatches` stages all hunks,
  `applyPatchGroup` refuses to write any file if preview fails, `rollbackApplied` reverts on
  mid-write failure (`patch.ts:72-119`).
- The diff matcher already has a sound cascade: exact → whitespace-normalized (0.95) →
  indentation-adjusted (0.90) → trigram-fuzzy (0.80). Only the trigram tier is risky.
- Server runs in the project root with `child_process` already in use — spawning `tsc`/lint/`git`
  is physically available where the tools live.
- Real test coverage already exists (`patch.test.ts`, `llm-proxy.test.ts`, `proxy.test.ts`,
  `ws-protocol.test.ts`, `security.test.ts`) — richer than CLAUDE.md implies.
- The rich Phase-3 DOM perception layer is **already computed on every selection** — the data
  exists, it is just discarded before reaching the model.

**Core limitation (the headline):** the loop is open. An edit is declared a success the instant it
is written (`apply → window.location.reload()` at `index.ts:611/856`) with no typecheck, lint,
parse, runtime, or console-error read-back. The harness structurally cannot distinguish a correct
edit from one that breaks the build, so the model never gets a correction signal and the user ships
broken code labeled "Applied".

## Target architecture

Move orchestration **out of the browser into the server** (`src/llm/agent-loop.ts`) as a bounded
multi-step state machine; the toolbar becomes a presentation/approval surface (it can't spawn
`tsc`/`git`/children or survive HMR reloads mid-loop). Two native paths that must **not** collapse
to a lowest common denominator:

- **Path A — API providers (openai/anthropic/google): native tool-calling.** Define JSON-Schema
  tools `read_file` / `search_code` / `list_dir` / `get_more_of_file` / `propose_edits` backed by
  the existing sandboxed handlers. The model reads *exact untruncated* file contents as a tool
  result and proposes edits against code it actually saw — collapsing the dominant search-mismatch
  failure. The 5-stage brace-repair scraper in `proxy.ts` survives only as a no-tool fallback.
  *(Real work: each adapter needs a streaming-parser rewrite — Anthropic `tool_use` +
  `input_json_delta`, Google `functionCall` parts — not just "add a `tools` array".)*
- **Path B — CLI agents (claude-code/codex/gemini): native edit + capture.** Stop writing
  `SYSTEM_PROMPT`'s JSON contract to stdin; give them a plain task prompt + element context +
  screenshot, let them edit the working tree natively, and capture the change via a **git
  checkpoint** (snapshot before, `git diff` after) translated into the existing `__DIFF__`/`FilePatch`
  payloads for the same approve/undo UI. Removes the double-apply and reclaims their multi-turn
  read/edit/verify ability. Non-git / dirty-tree projects fall back to a touched-file snapshot.

Both paths converge on a **verification gate**: after `applyPatchGroup`, a new `verify` op runs
cheapest-first — re-read/parse, then the project's own typecheck/lint npm script *if it exists*
(capability-probed, `AbortController`-cancellable, timeout-capped) — plus a **browser runtime layer**
(`window.onerror` + `unhandledrejection` + framework error-overlay scrape), the only signal that
catches "compiled but white-screened." On failure: auto-rollback via a durable on-disk manifest and
re-enter the loop with the errors + applied diff as one bounded (N≈2) self-correction turn; on
convergence failure, surface "reverted to last working state" with the real errors. Underneath:
`AbortController` threaded `agent-loop → adapter.chat → fetch()/child` so timeouts actually kill the
run, per-session cleanup on disconnect, and an on-disk `PatchManifest` (`~/.openmagic/manifests`)
with a parent pointer for multi-round chain rollback that survives restart.

---

## Recommendations

Tiers: **now** = cheap, low-risk, high-certainty wins on the *current* architecture · **next** =
the loop-closing structural work · **later** = the agentic rewrite + remaining hardening.
`†` = goes beyond the existing ROADMAP.md.

### Tier: now

| ID | Title | Effort / Impact / Risk |
|----|-------|------------------------|
| **H1†** | Sanitize history + actually deliver feedback to the model | S / high / low |
| **H2** | Forward the full `SelectedElement` (unlock the dead perception layer) | S / high / low |
| **H3†** | Auto-re-prompt on search-match failure instead of dead-ending | M / high / med |
| **H4†** | Cancellation: `AbortController` through adapter → fetch/child + `llm.cancel` | M / high / low |
| **H5** | Surface parse status (truncated / salvaged / failed) instead of silently dropping edits | M / high / low |

- **H1 — Sanitize history + deliver feedback.** `index.ts:1909` sends the entire `state.messages`
  array verbatim (base64 sentinels pollute the prompt) while load-bearing feedback encoded as
  `role:system` is dropped by **all three** API adapters and ignored by CLI adapters. Replace the
  `messages.map` with a `sanitizeHistory()` that strips sentinels and folds useful notes
  (rejections, "search did not match", verify errors) into the **current user turn** (`role:user`),
  so it survives the system-drop *and* reaches CLI agents. Fix the `role:system continue` in
  `openai.ts`, `anthropic.ts:26`, **and** `google.ts:25`. — *files:* `toolbar/index.ts`,
  `llm/openai.ts`, `llm/anthropic.ts`, `llm/google.ts`
- **H2 — Forward the full element.** `context-builder.ts:buildContext()` forwards only 7 element
  fields; `prompts.ts` rules 9–16 reference ~13 more (themeState, cssVariables, resolvedClasses,
  matchedCssRules, reactProps, childrenLayout, activeBreakpoints, visibilityState) that are always
  `undefined` at the model. Forward the whole object under a per-field byte budget; add a snapshot
  test asserting every field the prompt reads is present, to stop this drift regressing.
  *(`project.ground` already gets the full element for scoring — only the LLM-facing context is
  starved.)* — *files:* `toolbar/services/context-builder.ts`, `toolbar/index.ts`
- **H3 — Auto-re-prompt on match failure.** The most common LLM failure (a `search` block that
  doesn't byte-match) dead-ends: `applyDiff` (`index.ts:554-622`) / apply-all (`809-862`) push a
  `role:system` message and return. Wire a **new control-flow path** from `applyDiff` back into a
  fresh `sendPrompt` (the existing while-loop only handles NEED_FILE/SEARCH_FILES) that re-sends the
  unmatched search block + the real surrounding file region + "your search did not match; here is
  the actual code; regenerate", bounded by its own counter. Depends on **H1** so feedback reaches
  the model. — *files:* `toolbar/index.ts`
- **H4 — Cancellation.** On idle-timeout/disconnect, `ws-client` drops the handler but the
  server-side fetch or CLI child keeps running (burning tokens; CLI agents may keep editing files).
  Add `llm.cancel`/`agent.cancel {id}` and thread an `AbortSignal` through
  `handleLlmChat → adapter.chat → fetch()`/`child_process`. Prerequisite for the CLI native path and
  honest timeout reporting. — *files:* all `llm/*` adapters, `proxy.ts`, `server.ts`,
  `ws-client.ts`, `shared-types.ts`
- **H5 — Parse-status honesty.** `extractJsonFromResponse` brace-repair (`proxy.ts:48-56`) can
  fabricate a valid-but-wrong object; layer 5 (`:59-61`) salvages only `explanation` and returns
  `modifications:[]` — a stream cut mid-array looks identical to "no change". Thread a
  `parseStatus (clean|salvaged|truncated|failed)` through `llm.done` and show an explicit
  "response truncated — retry" affordance instead of prose-as-success. — *files:* `llm/proxy.ts`,
  `shared-types.ts`, `toolbar/index.ts`

### Tier: next — close the loop

| ID | Title | Effort / Impact / Risk | Depends |
|----|-------|------------------------|---------|
| **H6†** | Server-side verification gate + bounded self-correction turn | L / **critical** / med | H1, H8 |
| **H7†** | Browser runtime verification (`onerror` + overlay scrape) | M / high / med | H8 |
| **H8†** | Durable, unified, chain-aware rollback (persist manifests + git checkpoint) | M / high / med | — |
| **H9†** | CLI-agent native-edit path: stop forcing the JSON-diff contract | L / **critical** / high | H4, H8 |
| **H10** | Grounding truncation honesty + decoupled NEED_FILE budget | M / med / low | — |

- **H6 — Verification gate + self-correction.** *This is THE core fix.* Add `fs.patch.verify` (+
  `OPERATION_CATEGORIES` entry, `src/verify.ts`). Cheapest-first: re-read/parse touched files →
  *if* `package.json` declares a typecheck/lint script (probe via `detect.ts`), spawn it
  `cwd=roots[0]`, cancellable, ~20s cap. On **new** errors (diffed against a pre-apply baseline so
  pre-existing project errors aren't self-corrected) → auto-rollback via the durable manifest (H8) +
  inject a bounded (N=2) `SELF_CORRECT` turn. *Honest caveats:* `tsc` checks the whole program graph
  (no sound per-file mode) and often exceeds 20s on large repos → verification degrades to
  inconclusive exactly where edits are riskiest; sequence rollback/re-prompt against the existing
  +1.5s reload timer to avoid double-reload races. — *files:* `server.ts`, `verify.ts`, `patch.ts`,
  `detect.ts`, `shared-types.ts`, `toolbar/index.ts`, `llm/prompts.ts`
- **H7 — Browser runtime verification.** Add `installRuntimeErrorCapture` (`window.onerror` +
  `unhandledrejection`) next to the existing console capture; after reload, scrape the framework
  error overlay (`nextjs-portal`, vite-error-overlay shadow root, webpack overlay) and diff new
  console errors → `verify.runtime`. The **only** signal that catches "compiled but crashed" and it
  works for *all* providers. Source of truth across reload must be the server manifest (H8), not
  `sessionStorage` (which strips `applied.patches`). Additive signal, never the sole gate. —
  *files:* `toolbar/services/context-builder.ts`, `toolbar/index.ts`, `shared-types.ts`
- **H8 — Durable rollback substrate.** All undo state is RAM-only (`patch.ts` `manifests` Map +
  `filesystem.ts` `backupStack`, both wiped on shutdown), so a crash after a bad edit makes undo
  impossible. Persist `PatchManifest` to `~/.openmagic/manifests/<groupId>.json` with a **parent
  pointer** (so a self-correct chain rolls back to last-working-state = the *first* group's
  original content). TTL the backup dir instead of unconditional wipe; unify `fs.undo` and
  `fs.patch.rollback`; make `rollbackApplied` return failures (it currently swallows them in an
  empty catch). Git checkpoint before each apply when the project is a repo; offer to restore
  unfinished manifests on startup. — *files:* `patch.ts`, `filesystem.ts`, `server.ts`,
  `toolbar/index.ts`
- **H9 — CLI native-edit path.** *Highest strategic leverage.* Branch on the standalone
  `isCliProvider()` at adapter/prompt selection: send CLI agents a plain task prompt (not
  `SYSTEM_PROMPT`), let them edit + self-verify natively, capture via git before/after, translate
  the diff into the existing `__DIFF__`/`FilePatch` cards. Thread session resume
  (`claude --resume` / `codex resume`) + full history for follow-ups; parse Gemini structurally.
  *Honest tradeoffs (document, don't footnote):* (a) **security regression** — files are written
  *before* the user approves, inverting review-then-write; HMR may reload a half-broken state; (b)
  requires **git** — needs a non-git/dirty-tree fallback; (c) the diff cards currently build from
  parsed JSON, so a git-diff→card parser is real work. Realistically **L→XL**; ship behind a
  per-provider flag. — *files:* `llm/execution-adapters.ts`, the three CLI adapters,
  `llm/native-capture.ts` (new), `llm/proxy.ts`, `toolbar/index.ts`
- **H10 — Grounding truncation honesty.** Grounding silently slices files to 12KB
  (`index.ts:1662`, `project-grounding.ts:90`) with no marker → guaranteed search failures on large
  files. (a) Replace silent slices with `// [TRUNCATED at line N of M — request remainder via
  NEED_FILE]` markers (escape ``` fences first). (b) Give NEED_FILE its own counter (today it shares
  the 4-retry budget with SEARCH_FILES at `index.ts:1896`) and return the full file. (c) When real
  mods coexist with NEED_FILE, apply them **and** continue the loop instead of discarding the
  directive. Folds ROADMAP P2. — *files:* `toolbar/index.ts`, `project-grounding.ts`

### Tier: later — the agentic rewrite + remaining hardening

| ID | Title | Effort / Impact / Risk | Depends |
|----|-------|------------------------|---------|
| **H11†** | Native tool-calling for API providers (kill the string contract) | L / high / med | H4, H6 |
| **H12†** | Move orchestration server-side (`agent.run` state machine) | L / high / high | H4, H6, H11 |
| **H13†** | Plumb user-selected thinking level + raise hardcoded output-token caps | M / med / low | — |
| **H14** | Apply-safety: trigram gate, visible confidence, rollback errors, `timingSafeEqual` | M / med / med | H3 |
| **H15†** | Feed the approved plan into the edit pass; clarify-on-ambiguity + repo conventions | M / med / low | — |

- **H11 — Native tool-calling.** No API adapter uses function-calling; the contract is a
  hand-written JSON string scraped back with 5-stage brace-repair. Define schema tools backed by the
  sandboxed handlers; gate on the **already-existing-but-dead** `tools:boolean` registry flag
  (`models.ts`). Removes the false edit-OR-investigate either/or and gives schema-validated edits.
  *Scope honesty:* per-adapter streaming-parser rewrites; keep `extractJsonFromResponse` as fallback;
  note 12KB truncation lives in the toolbar grounding path, **not** `readFileSafe` (which returns
  full files), so `get_more_of_file` pages the grounding layer. — *files:* `llm/tools.ts` (new), the
  three API adapters, `prompts.ts`, `proxy.ts`, `agent-loop.ts`
- **H12 — Server-side `agent.run` state machine.** The investigate→edit loop currently lives in the
  browser (`sendPrompt` while-loop `index.ts:1895-2074`) with regex scraping and a 4-retry counter.
  Move it to `src/llm/agent-loop.ts`, bounded by a step+token budget (~12 tool calls); toolbar
  becomes a thin renderer driven by `agent.step`/`agent.diffs`/`agent.verify`/`agent.done`. Per-session
  cleanup on disconnect; cancel-on-close (H4) must be bulletproof. Keep `llm.chat` one release. —
  *files:* `llm/agent-loop.ts` (new), `server.ts`, `shared-types.ts`, `toolbar/index.ts`,
  `ws-client.ts`
- **H13 — Thinking level + token caps.** Output caps are hardcoded far below capability (openai
  4096, google 8192, anthropic 4096) while the registry declares `maxOutput` up to 128000 — a
  multi-file edit hits the ceiling mid-JSON. Read per-request `reasoningLevel`/`thinkingBudget` and
  map to `reasoning_effort` / `thinking.budget_tokens` / `thinkingConfig`; raise `max_tokens` toward
  `maxOutput`; add `finish_reason==='length'` detection + bounded continuation instead of feeding a
  cut body to brace-repair. — *files:* the three API adapters, `registry.ts`
- **H14 — Apply-safety hardening.** Raise **only** the trigram tier (`patch.ts:312`) toward ~0.92
  and refuse fuzzy for multi-hunk groups; surface `confidence<1.0` in the diff card. **⚠ Must
  resolve a real contradiction:** `tests/patch.test.ts:156` asserts `ok===true` for a ~0.8776 case,
  and ROADMAP P1 specifies "≥0.8" — raising the gate inverts both, so update the test + reconcile
  the roadmap deliberately. Use `crypto.timingSafeEqual` in `validateToken` (`security.ts:17`).
  Sequence **after H3** so rejected edits auto-re-prompt rather than silently dropping apply rate.
  Folds ROADMAP P1. — *files:* `patch.ts`, `security.ts`, `filesystem.ts`, `toolbar/index.ts`,
  `tests/patch.test.ts`
- **H15 — Plan-into-edit + conventions.** confirm-plan re-runs `sendPrompt` with only the original
  prompt text (`index.ts:775`); the approved plan is re-derived and invisible to CLI providers.
  Prepend "Approved plan: …" to the edit-pass user message (survives the role drop, reaches CLI
  agents). Add a runtime-built "repo conventions" block (framework/router, package manager,
  component location, TS strictness) + an explicit clarify-on-ambiguity rule. Folds remaining
  ROADMAP P5 UX + P6 tests. — *files:* `toolbar/index.ts`, `prompts.ts`, `project-grounding.ts`

---

## Reconciliation with `ROADMAP.md`

ROADMAP.md is sound but **mis-scoped** for "a better harness": it is six phases of *robustness of
the one-shot loop* and never closes the loop. Keep it as the **substrate**, not the headline.

- **Keep (low-risk plumbing / substrate):** P1.1 CRLF/BOM, P1.2 atomic fsync writes, P1.3 layered
  matcher (cascade already exists — only trigram needs hardening, see H14), P1.4 transactional
  apply-all (**largely already implemented** in `applyPatchGroup`; the gap is *durability* → H8).
- **Already done / partially done:** P2 budgets are already 8 files / 48KB (fold remainder into
  H10). **P3 element context is captured but discarded** — its value is unlocked by the one-object
  fix **H2**, not by capturing more signals. **P4.1 malformed-JSON truncation repair is already
  implemented** (`proxy.ts:48-62`) — superseded by H5, then obsoleted by H11.
- **Subsumed / reprioritized:** P4.2 stream recovery → H4 + H8. P4.3 "diff feedback loop" is exactly
  **H1+H3 done properly** (P4.3 as written pushes `role:system`, which is *dropped* — it never
  reaches the model). P5 UX + P6 tests → H15.
- **Superseded:** P1.5 multi-level in-memory undo → H8's durable on-disk manifests. P4.1's
  JSON-string-recovery investment is transition-only once H11 lands.

**Net reorder:** land **H1, H2, H3, H4, H5** first (cheap, immediate quality), then the loop-closing
work (**H6, H8, H9, H7**), then the agentic rewrite (**H11, H12**). The robustness items remain valid
for the API/fallback path but move *beneath* the loop-closing work they never addressed.

## Open decisions (need your call)

1. **Verification cost on big repos.** Full-project `tsc` on large Next.js/monorepos will frequently
   exceed ~20s → inconclusive exactly where edits are riskiest. Accept that and lean on the browser
   runtime layer (H7) as the primary gate for big repos? Require a pre-apply baseline run (≈2× cost)
   to attribute only *new* errors?
2. **CLI native-edit trust model (H9).** Comfortable inverting CLI agents from review-then-write to
   **write-then-review** (agent edits disk before approval; HMR may reload a half-broken app),
   recovered by git-diff capture + undo? This is a documented regression of the current
   path-sandbox guarantee.
3. **Git dependency (H9).** Non-git / dirty trees: touched-file snapshot fallback, or refuse
   native-edit and keep the JSON contract for those?
4. **Scope of the rewrite.** Full server-side agent loop + tool-calling (H11/H12 — multi-release,
   carries both harnesses during transition), or the pragmatic path (H1–H10) on the existing
   architecture first, deferring tool-calling?
5. **Self-correction budget.** N=2 rounds / 12 tool-call budget are guesses. Cost/latency ceiling
   per request? (Multi-turn loops with untruncated file re-sends multiply token cost several-fold,
   and no adapter implements prompt caching today.)
