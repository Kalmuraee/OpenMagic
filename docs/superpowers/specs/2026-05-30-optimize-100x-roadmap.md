# OpenMagic 100x — Optimization Roadmap

> Goal: make OpenMagic dramatically better across **all four** dimensions the user
> selected — capability, UX, trust, and reach. The open agentic loop is already
> closed (verify gate + self-correction + native tool-calling, PR #26). This
> milestone builds on that foundation. Each phase is its own design → TDD →
> verify → commit cycle.

## North-star metric

**Edit-success-rate (ESR):** the % of scenarios where a user request results in
applied changes that (a) match the intended outcome and (b) pass the project's
own typecheck/lint. Everything below is justified by its expected lift to ESR,
time-to-first-correct-edit, or adoption. We can't claim "100x" without measuring
it — which is why **Phase 1 is the eval harness**.

## Phases (sequenced by leverage + dependencies)

### Phase 1 — Q1: Eval harness (the measurement backbone) ← START HERE
**Why first:** defines "better" measurably and guards every later change.
- `evals/fixtures/*` — small but realistic apps (vanilla, React/Vite, Next-ish).
- `evals/scenarios/*.json` — each: `{ name, fixture, prompt, selectedElement,
  recordedResponse (modifications), expect }`. Deterministic: replays a known LLM
  response through the **real** grounding → patch → verify pipeline (no API key,
  CI-safe).
- `evals/run.mjs` — copies a fixture to a temp dir, runs `groundProject`, applies
  the recorded modifications via `applyPatchGroup`, runs `verifyPatchGroup`,
  scores each scenario, prints an ESR report; non-zero exit if below threshold.
- Optional `--live` mode (keyed, manual/nightly) that calls a real provider to
  measure true ESR.
- `npm run eval` + CI wiring (deterministic mode).
**Done when:** `npm run eval` reports ESR over a seed scenario set and fails CI on
regressions.

### Phase 2 — C1: Codebase symbol index (capability multiplier)
**Why:** the dominant edit failure is grounding the wrong/incomplete file. A
symbol/import/route index lets grounding + tools resolve targets first-try.
- `src/symbol-index.ts` — scan project (bounded), extract exported symbols,
  component names, route files, import edges. Cache with mtime invalidation.
- Feed into `project-grounding.ts` scoring (exact symbol/component hits) and as a
  `find_symbol`/`who_imports` tool for the H11 tool loop.
**Done when:** eval ESR improves on symbol-targeted scenarios; new scenarios added.

### Phase 3 — U1+U2: Visual diff + inline element editing (the visible win)
- U1: rich syntax-highlighted side-by-side diff cards with line numbers.
- U2: direct in-place editing of selected element text/spacing/color → generate
  the corresponding code diff (no prose round-trip for simple changes).
**Done when:** diff cards render real syntax highlighting; inline edits produce
correct diffs; browser E2E covers it.

### Phase 4 — C3: Streaming tool-calling + prompt caching
- Upgrade the H11 non-streaming tool loop to stream tokens during the final
  answer; add provider prompt caching (Anthropic cache_control, OpenAI/Gemini
  equivalents) for big cost/latency cuts on repeated context.
**Done when:** cached requests measurably cheaper; streaming restored under tools.

### Phase 5 — C2: H12 server-side agent loop (the agentic rewrite)
- Move investigate→edit orchestration into `src/llm/agent-loop.ts` (`agent.run`
  state machine, step/token budget); toolbar becomes a thin renderer driven by
  `agent.step`/`agent.diffs`/`agent.verify`/`agent.done`. Keep `llm.chat` one
  release. Multi-step autonomous tasks (opt-in).
**Done when:** eval ESR ≥ client-loop baseline; cancellation bulletproof.

### Phase 6 — Q2: Runtime→self-correct bridge + regression depth
- Persist a pending-verify marker across reload; after reload scrape the error
  overlay/runtime errors and feed into the H6 self-correct loop (catches
  "compiled but crashed"). Golden-file tests for grounding/diff.

### Phase 7 — U3+U4: Multi-select, command palette, undo timeline, design pass
- Multi-element selection + batched context; ⌘K command palette; undo/redo
  timeline UI; design-token pass (light/dark, spacing, motion).

### Phase 8 — R1–R4: Reach
- Landing page + animated live demo; first-run onboarding; more frameworks
  (Remix, Nuxt, SvelteKit, Solid, Angular) with detection + route mapping; docs
  site.

## Sequencing rationale
Measure (1) → make it smarter (2) → make it visibly better (3) → make it
cheaper/faster (4) → make it truly agentic (5) → make it catch runtime bugs (6) →
make it delightful (7) → grow users (8). Each phase is independently shippable and
its win is checked against the Phase-1 eval harness.

## Working agreement
- One phase at a time, on `feat/optimize-100x` (stacked on PR #26).
- TDD for all new logic; `npm run check:all` green before each commit; browser
  E2E at UX-touching boundaries.
- Each phase committed atomically; progress reported between phases.
