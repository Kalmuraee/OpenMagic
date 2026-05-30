# OpenMagic — Advanced Guide

Power-user features and configuration. For the basics, see the [README](../README.md).

## The closed loop (verification + self-correction)

After OpenMagic applies an edit it **verifies** it before declaring success:

1. **Type/lint check** — if your `package.json` has a `typecheck`, `type-check`,
   `tsc`, `lint`, or `check` script, OpenMagic runs it (cancellable, ~20s cap).
   Errors are attributed to the edit (the output must mention an edited file), so
   pre-existing project errors never trigger a false revert.
2. **Runtime check** — after the page reloads, OpenMagic scrapes the framework
   error overlay (Next.js / Vite / webpack) and any uncaught errors. This catches
   edits that *compiled but crashed at runtime*.

If either check fails, the change is **reverted to the last working state** and the
errors are fed back to the model for a bounded (2-round) self-correction. An edit
that breaks your build is never silently reported as "Applied".

Undo history is durable: patch manifests are persisted to
`~/.openmagic/manifests/` and survive a restart, with chained rollback back to the
original content across self-correction rounds.

## Command palette (⌘K / Ctrl+K)

Press **⌘K** to open a searchable command palette: select an element, open
settings, apply all pending changes, undo/redo the last change, focus the prompt,
and more. Type to fuzzy-filter, arrow keys to navigate, Enter to run.

## Inline text editing

Select an element with short text and an inline editor appears in the prompt bar.
Edit the text and hit **Edit text** — OpenMagic finds the text in your source and
produces the change **deterministically** (no LLM round-trip) when it can,
falling back to a focused prompt when the text isn't found verbatim.

## Native tool-calling (opt-in)

Tool-capable providers (OpenAI-family, Anthropic, Google) can use native
tool-calling — the model reads exact file contents via `read_file` / `search_code`
/ `list_dir` / `find_symbol` and proposes edits against code it actually saw,
collapsing the most common search-mismatch failures.

Enable it with `OPENMAGIC_TOOLS=1` or `"useTools": true` in
`~/.openmagic/config.json`. When off, OpenMagic uses the streamed JSON-diff
contract (the default).

## CLI native-edit (opt-in, git only)

CLI agents (Claude Code, Codex, Gemini) can edit your working tree natively and
self-verify, then OpenMagic captures the diff via git, **reverts it**, and routes
the change through the normal review → apply → verify flow — so you keep
review-then-write safety while reclaiming the agents' multi-turn editing power.

Enable with `OPENMAGIC_NATIVE_EDIT=1` or `"nativeEdit": true`. Requires a git repo
with a clean working tree; non-git/dirty trees fall back to the JSON contract.

## Thinking level

Set a per-provider reasoning level in `~/.openmagic/config.json`:

```json
{ "preferredThinkingMode": { "anthropic": "high", "openai": "medium" } }
```

Levels: `none`, `low`, `medium`, `high`, `xhigh`. Output token caps are taken from
each model's real capability (no artificial 4096 ceiling), and prompt caching is
used automatically where supported.

## Supported frameworks (grounding)

OpenMagic maps the page URL to the right source file for: **Next.js, Remix /
React Router v7, Nuxt, SvelteKit, SolidStart/Solid, Angular, Astro, Vite + React,
Vue**, plus generic projects. It also builds a symbol index so a selected
component is grounded to the file that exports it — even when the filename doesn't
match the component name.

## Eval harness (edit-success-rate)

OpenMagic ships an eval suite that measures **Edit-Success-Rate (ESR)** — the
fraction of scenarios where a request produces an applied change matching the
intended outcome:

```bash
npm run eval
```

It replays recorded responses through the real grounding → patch pipeline against
fixture apps (deterministic, no API key), and runs in CI to guard against
regressions. Add scenarios in `evals/scenarios/*.json`.
