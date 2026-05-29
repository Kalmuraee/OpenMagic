# OpenMagic Robustness & Resilience Roadmap

## Phase 1: Code Safety (Prevent Data Loss)

The #1 risk: a bad diff corrupts user code with no way back. Every change below makes edits safer.

### 1.1 Normalize line endings and BOM on read, restore on write

**File**: `src/filesystem.ts` (readFileSafe, writeFileSafe)

Before any diff matching:
- Detect BOM (`\uFEFF` or bytes `EF BB BF`) and strip it
- Detect line ending style (CRLF vs LF) from the file's first occurrence
- Normalize content to LF internally

On write:
- Restore original line endings
- Restore BOM if it was present

This eliminates the entire class of "exact match fails because of CRLF" bugs. Pattern from Prettier: normalize before processing, restore after.

```
Read: raw → detect BOM → strip → detect CRLF → normalize to LF → return {content, hasBOM, lineEnding}
Write: content → replace LF with original lineEnding → prepend BOM if needed → atomic write
```

### 1.2 Atomic file writes with fsync

**File**: `src/filesystem.ts` (writeFileSafe)

Current: `writeFileSync(filePath, content)` — can corrupt on crash.

Replace with:
1. Write to temp file in same directory
2. `fsync()` the file descriptor
3. `close()` the fd
4. `rename()` temp → target (atomic on POSIX)
5. On error: `unlink()` temp

Use the `write-file-atomic` npm package or implement the 5-step pattern directly (no new deps needed).

### 1.3 Layered diff matching (Aider-style)

**File**: `src/toolbar/index.ts` (applyDiff, fuzzyLineMatch)

Current: exact match → fuzzy line match (trim + compare). Two layers.

Replace with 4-layer cascade (based on Aider's proven approach):

1. **Exact match** — `content.includes(search)`, single occurrence
2. **Whitespace-normalized match** — strip leading/trailing whitespace per line, compare
3. **Indentation-adjusted match** — strip leading whitespace from search, find match, compute indentation delta, apply delta to replace block
4. **Similarity-based fuzzy match** — sliding window with similarity score >= 0.8 threshold (like Aider's `replace_most_similar_chunk`)

Key improvement: layer 3 (indentation adjustment) is what Aider uses to handle the most common LLM error — wrong indentation in the search block.

### 1.4 Batch Apply All with rollback

**File**: `src/toolbar/index.ts` (handleAction "apply-all")

Current: diffs applied sequentially. If #3 fails, #1 and #2 are already written. No rollback.

Fix:
1. Before batch, snapshot all target files (read + store in memory)
2. Apply diffs one by one
3. If any fails: restore all snapshots, show which diff failed
4. Only if all succeed: clear snapshots, show success

This is transaction semantics for file edits. The in-memory snapshots are small (typically < 100KB total).

### 1.5 Multi-level undo history

**Files**: `src/filesystem.ts`, `src/server.ts`, `src/toolbar/index.ts`

Current: one backup per file (last edit only).

Replace with a stack-based undo system:
- `backupStack: Map<string, string[]>` — each file has an array of backups
- Max 10 entries per file (oldest evicted)
- `fs.undo` pops the latest backup
- UI shows undo count per file
- All cleared on shutdown

### 1.6 Tests for diff application

**File**: `tests/diff.test.ts` (new)

Test cases:
- Exact match (happy path)
- Whitespace-only difference (trailing spaces)
- CRLF file with LF search block
- File with BOM
- Tab indentation file, space-indented search
- Multiple identical blocks (should reject or match correct one)
- Empty search (create file)
- Unicode content (emoji, Arabic, CJK)
- Very large file (50KB+, edit in the middle)
- Search block with blank lines

---

## Phase 2: Grounding Accuracy (Give the LLM the Right Files)

The LLM can only fix what it can see. These changes ensure it sees the right context.

### 2.1 Auto-ground project config files

**File**: `src/toolbar/index.ts` (sendPrompt, after CONFIG_CANDIDATES)

Add to CONFIG_CANDIDATES:
```
"tsconfig.json", "tsconfig.app.json",
"next.config.js", "next.config.mjs", "next.config.ts",
"vite.config.ts", "vite.config.js",
"astro.config.mjs",
".eslintrc.json", ".prettierrc",
"theme.ts", "theme.js",
```

For tsconfig specifically: extract `compilerOptions.paths` and `compilerOptions.baseUrl` — this tells the LLM how imports resolve (e.g., `@/` maps to `src/`).

### 2.2 Parallel file reads during grounding

**File**: `src/toolbar/index.ts` (sendPrompt, file reading loop)

Current: files read sequentially with `await` in a for loop.

Fix: batch reads with `Promise.all` (up to 5 concurrent):
```ts
const readPromises = scored.slice(0, MAX_GROUNDED_FILES).map(f => ws.request("fs.read", ...));
const results = await Promise.all(readPromises);
```

This cuts grounding time from ~500ms (5 sequential reads) to ~100ms (parallel).

### 2.3 Increase grounding budget for large projects

**File**: `src/toolbar/index.ts` (constants)

Current: MAX_GROUNDED_FILES=5, MAX_GROUNDED_CHARS=32000, per-file=8000.

Increase to: MAX_GROUNDED_FILES=8, MAX_GROUNDED_CHARS=48000, per-file=12000.

Modern LLMs (GPT-5.4, Claude Opus 4.6) have 200K-1M context. 48KB is less than 1% of most models' context. The cost increase is negligible ($0.01-0.02 more per request).

### 2.4 Import path resolution from tsconfig

**File**: `src/toolbar/index.ts` (import following block)

Current: only follows relative imports (`./Component`).

Add: resolve path aliases from tsconfig.json:
- Read `compilerOptions.paths` (e.g., `{"@/*": ["src/*"]}`)
- When seeing `import from '@/components/Button'`, resolve to `src/components/Button.tsx`
- Try common alias patterns: `@/`, `~/`, `#/`

---

## Phase 3: Element Context (Help the LLM See What You See)

### 3.1 Dark mode / theme state detection

**File**: `src/toolbar/services/dom-inspector.ts` (inspectElement)

Add to SelectedElement:
```ts
themeState: {
  darkMode: boolean;          // html[data-theme="dark"] or prefers-color-scheme match
  htmlDataAttributes: Record<string, string>;  // all data-* on <html>
  colorScheme: string;         // getComputedStyle(html).colorScheme
}
```

Check: `document.documentElement.dataset`, `window.matchMedia('(prefers-color-scheme: dark)').matches`, `getComputedStyle(document.documentElement).colorScheme`.

### 3.2 CSS custom property extraction

**File**: `src/toolbar/services/dom-inspector.ts` (inspectElement)

Add to SelectedElement:
```ts
cssVariables: Record<string, string>;  // CSS custom properties used by this element
```

Implementation: iterate `computedStyles`, for any value containing `var(--`, extract the variable name, resolve it via `getComputedStyle(element).getPropertyValue('--name')`.

Also scan the element's matched CSS rules for `var()` references and resolve them.

### 3.3 z-index stacking context

**File**: `src/toolbar/services/dom-inspector.ts` (inspectElement)

Add:
```ts
stackingContext: {
  zIndex: string;
  createsContext: boolean;  // position:relative/absolute/fixed + z-index != auto
  parentZIndex: string;
}
```

### 3.4 Scroll and visibility state

**File**: `src/toolbar/services/dom-inspector.ts` (inspectElement)

Add:
```ts
visibilityState: {
  isVisible: boolean;         // element.checkVisibility() or manual check
  isInViewport: boolean;      // getBoundingClientRect vs viewport
  scrollTop: number;          // element.scrollTop
  scrollLeft: number;
  isScrollable: boolean;      // overflow != visible && scrollHeight > clientHeight
  parentScrollContainer: string | null;  // CSS selector of nearest scrollable ancestor
}
```

### 3.5 Active media queries

**File**: `src/toolbar/services/dom-inspector.ts` (inspectElement)

Add:
```ts
activeBreakpoints: string[];  // e.g., ["(min-width: 768px)", "(prefers-color-scheme: dark)"]
```

Check common breakpoints and `prefers-*` queries via `window.matchMedia()`.

### 3.6 Update system prompt with new signals

**File**: `src/llm/prompts.ts` (SYSTEM_PROMPT)

Add rules:
```
8. Use childrenLayout pixel measurements to understand exact spacing. gapToNext.vertical=0 means elements are touching.
9. Use resolvedClasses to know actual CSS values behind utility classes (e.g., space-y-6 = margin-top: 1.5rem).
10. Check themeState.darkMode — if true, suggest dark-mode-aware colors.
11. Use cssVariables to leverage existing design tokens (var(--color-primary)) instead of hardcoded values.
12. Check visibilityState to understand if the element is scrolled out of view or hidden.
```

---

## Phase 4: Error Recovery (Don't Break on Edge Cases)

### 4.1 Malformed JSON recovery

**File**: `src/llm/proxy.ts` (extractJsonFromResponse)

Current: brace-counting extraction fails on truncated JSON.

Add recovery layers:
1. Try `JSON.parse(content)` — clean JSON
2. Try markdown extraction — ```json blocks
3. Try brace-counting — raw JSON in text
4. **NEW**: Try truncation repair — if brace count is imbalanced, add closing `}]` and retry
5. **NEW**: Try extracting just the explanation field with regex — `/"explanation"\s*:\s*"([^"]+)"/`

### 4.2 Stream disconnect recovery

**File**: `src/toolbar/services/ws-client.ts`, `src/toolbar/index.ts`

Current: on disconnect, partial response is lost. User must resend.

Fix:
- On stream timeout or disconnect, save `state.streamContent` as a partial response
- Show it to the user with a "Response was interrupted. Partial content:" prefix
- Add a "Retry" button that resends the same prompt with the same context

### 4.3 Diff feedback loop

**File**: `src/toolbar/index.ts` (rejectDiff)

Current: rejected diffs are silently removed. LLM doesn't learn.

Fix: when the user rejects a diff, add a system message to `state.messages`:
```
[system] User rejected the change to {file}: {search block first line}... → {replace block first line}...
```

On the next prompt, this context tells the LLM what didn't work. The LLM can adjust its approach.

### 4.4 Config save error handling

**File**: `src/toolbar/index.ts` (saveSettings)

Current: if config.set fails, UI may still transition to chat.

Fix: only transition to chat after confirmed save response. Show error in settings panel if save fails.

---

## Phase 5: UX Polish (Match Competitor Quality)

### 5.1 Side-by-side diff preview

**File**: `src/toolbar/index.ts` (renderChatHTML, diff card rendering)

Current: shows 200 chars of removed text and 300 chars of added text as plain text.

Replace with:
- Full search block and replace block displayed
- Line-by-line diff with red (removed) and green (added) backgrounds
- Syntax-aware indentation preservation
- Scrollable if content is long
- Line numbers on both sides

### 5.2 Keyboard shortcuts

**File**: `src/toolbar/index.ts` (attachGlobalEvents)

Add:
- `Cmd+K` / `Ctrl+K`: focus prompt input
- `Cmd+Enter`: send message (already exists)
- `Cmd+Z`: undo last applied diff
- `Cmd+Shift+Z`: redo (if undo was used)
- `Escape`: close panel / cancel selection (exists)
- `Cmd+.`: apply all pending diffs

### 5.3 Model switching mid-conversation

**File**: `src/toolbar/index.ts` (toolbar header)

Add a model selector dropdown to the prompt bar (not in settings). Changing model doesn't clear chat history — just sends the next message with the new model.

### 5.4 Token count and cost estimation

**File**: `src/toolbar/index.ts` (sendPrompt)

Before sending:
- Estimate input tokens: `(contextChars / 4)` rough approximation
- Show in prompt bar: "~12K tokens, ~$0.03"
- Warning badge if estimated cost > $0.50

After response:
- Show actual tokens used (from LLM response headers if available)
- Running session total

### 5.5 Screenshot compression

**File**: `src/toolbar/services/capture.ts`

Current: full-resolution PNG. Can be 2-3MB.

Fix:
- Resize to max 1280px wide (maintaining aspect ratio)
- Convert to JPEG at 80% quality
- Use `<canvas>` for resize + format conversion
- Target: < 200KB per screenshot

### 5.6 Message history pruning

**File**: `src/toolbar/index.ts` (saveState)

Current: all messages saved to sessionStorage. Grows unbounded.

Fix:
- Cap at 50 messages in sessionStorage
- Older messages evicted (keep first 5 for context + last 45)
- Diff payloads (base64) stripped from stored messages (only keep the "Applied change" summary)

---

## Phase 6: Testing (Prevent Regressions)

### 6.1 Diff application tests

`tests/diff.test.ts` — covers Phase 1.3 and 1.6.

### 6.2 Proxy tests

`tests/proxy.test.ts`:
- HTML injection: verify script tag appended to HTML responses
- Non-HTML passthrough: verify assets pass unchanged
- Error wrapping: verify 4xx/5xx gets toolbar HTML wrapper
- CSP header stripping: verify CSP removed from HTML responses
- WebSocket upgrade routing: verify OpenMagic WS vs dev server WS

### 6.3 LLM adapter tests

`tests/llm-proxy.test.ts`:
- JSON extraction: valid JSON, markdown-wrapped, truncated, empty
- Provider routing: verify correct adapter called for each provider
- Error handling: network errors, auth errors, timeout

### 6.4 Grounding tests

`tests/grounding.test.ts`:
- File scoring: verify route tokens, component hints, monorepo detection
- Config auto-grounding: verify tailwind.config, globals.css found
- Layout auto-read: verify layout.tsx walked up directory tree
- Import following: verify relative imports resolved

### 6.5 WebSocket protocol tests

`tests/ws-protocol.test.ts`:
- Handshake: valid token accepted, invalid rejected
- Message routing: each type handled correctly
- Stream timeout: idle timeout resets on chunks
- Reconnection: verify auto-reconnect with backoff

---

## Implementation Order

Based on your priority (robustness and resilience):

```
Week 1: Phase 1 (Code Safety)
  1.1 CRLF/BOM normalization
  1.2 Atomic writes
  1.3 Layered diff matching
  1.4 Batch rollback
  1.6 Diff tests

Week 2: Phase 4 (Error Recovery) + Phase 6.1
  4.1 Malformed JSON recovery
  4.2 Stream disconnect recovery
  4.3 Diff feedback loop
  6.1 Diff application tests

Week 3: Phase 2 (Grounding)
  2.1 Config file grounding
  2.2 Parallel reads
  2.3 Larger budget
  2.4 tsconfig path resolution

Week 4: Phase 3 (Element Context)
  3.1 Dark mode detection
  3.2 CSS variables
  3.3 z-index context
  3.6 System prompt update

Week 5: Phase 5 (UX)
  5.1 Side-by-side diff
  5.2 Keyboard shortcuts
  5.5 Screenshot compression
  5.6 Message pruning

Week 6: Phase 6 (Testing)
  6.2-6.5 Proxy, LLM, grounding, WS tests
```

## Total scope

- ~26 features across 6 phases
- ~15 files modified, ~5 new test files
- Estimated: ~2500 lines of code
- No new npm dependencies (except optionally write-file-atomic)
