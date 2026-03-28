# Contributing to OpenMagic

PRs are welcome! Whether it's a bug fix, new feature, new LLM provider, or documentation improvement — we appreciate every contribution.

---

## Quick Start

```bash
git clone https://github.com/Kalmuraee/OpenMagic.git
cd OpenMagic
npm install
npm run build
```

To test locally, start any dev server (e.g., a Vite or Next.js app), then:

```bash
node dist/cli.js --port 3000
```

This opens a proxied version of your app at `localhost:4567` with the toolbar injected.

---

## Project Architecture

OpenMagic is a single-port reverse proxy that injects a floating AI toolbar into any web app during development.

```
src/
├── cli.ts              # CLI entry — commander, port detection, dev server management
├── proxy.ts            # Reverse proxy (http-proxy), streaming HTML injection
├── server.ts           # WebSocket server, file I/O, LLM routing, debug.logs endpoint
├── filesystem.ts       # Sandboxed file read/write with path traversal protection
├── config.ts           # Atomic config persistence (~/.openmagic/config.json)
├── security.ts         # Session token generation (randomBytes)
├── detect.ts           # Dev server auto-detection (script parsing, port scanning)
├── shared-types.ts     # TypeScript interfaces for WebSocket protocol
├── llm/
│   ├── registry.ts     # 14 providers, 70+ models — all pre-configured
│   ├── proxy.ts        # LLM routing — picks adapter based on provider
│   ├── prompts.ts      # System prompt and context builder for LLM calls
│   ├── openai.ts       # OpenAI-compatible adapter (also used by Groq, Mistral, etc.)
│   ├── anthropic.ts    # Anthropic adapter with extended thinking support
│   └── google.ts       # Google Gemini adapter
├── toolbar/
│   ├── index.ts        # Main toolbar — Shadow DOM Web Component (~1800 lines)
│   ├── services/
│   │   ├── ws-client.ts       # WebSocket client with handshake, reconnect, streaming
│   │   ├── dom-inspector.ts   # Element inspection, CSS rules, React fiber props
│   │   ├── capture.ts         # Screenshot via SVG foreignObject
│   │   └── context-builder.ts # Network/console capture, context assembly
│   └── styles/
│       └── toolbar.css.ts     # All toolbar CSS (injected into Shadow DOM)
tests/
├── config.test.ts
├── detect.test.ts
├── filesystem.test.ts
└── security.test.ts
```

### Key design decisions

- **Single port**: The proxy, toolbar bundle, and WebSocket all share one HTTP server. No CORS issues.
- **Shadow DOM**: The toolbar is a Web Component with a closed shadow root — fully isolated from the host app's styles.
- **Event delegation**: All toolbar click/change handlers are attached once to the root, using `data-action` attributes. No listener accumulation across re-renders.
- **Streaming HTML injection**: HTML responses are streamed through — the toolbar `<script>` tag is appended at the end of the stream, not buffered.
- **Fuzzy diff matching**: When applying LLM-proposed edits, exact match is tried first, then line-by-line fuzzy matching to handle indentation differences.

---

## How to Add a New LLM Provider

1. **Add to the registry** in `src/llm/registry.ts`:
   ```ts
   newprovider: {
     name: "New Provider",
     baseUrl: "https://api.newprovider.com/v1",
     models: [
       { id: "model-id", name: "Model Name", maxTokens: 4096 },
     ],
   },
   ```

2. **If OpenAI-compatible** (most are): no adapter needed — `src/llm/openai.ts` handles it automatically via the registry's `baseUrl`.

3. **If not OpenAI-compatible**: create `src/llm/newprovider.ts` with `chat()` function matching the same signature as `openai.ts`, then add routing in `src/llm/proxy.ts`.

4. **Add to the toolbar registry** in `src/toolbar/index.ts` (the `MODEL_REGISTRY` object near the top) so users can select it from the dropdown.

---

## How to Modify the Toolbar UI

The toolbar lives in `src/toolbar/index.ts` as a Shadow DOM Web Component.

- **DOM is built once** in `buildStaticDOM()` — returns an HTML string.
- **Updates are targeted** — functions like `updateStatusDot()`, `updatePillButtons()`, `refreshPanelContent()` update specific elements, not the whole tree.
- **Actions use data attributes** — add `data-action="your-action"` to any button, then handle it in `handleAction()`.
- **Styles** go in `src/toolbar/styles/toolbar.css.ts` — exported as a string and injected into the shadow root.
- **No emojis in the toolbar UI** — use SVG icons (defined in the `ICON` object at the top of `index.ts`).

---

## Code Style

- **TypeScript strict mode** — `tsconfig.json` has strict enabled
- Keep code consistent with the existing style in each file
- No eslint config yet — just match what's there
- Prefer simple, direct code over abstractions
- Toolbar icons: SVG only, no emojis (except the `✨OpenMagic🪄` brand text)

---

## Testing

```bash
npm test           # Run all tests (vitest)
npm run build      # Build CLI + toolbar
npx tsc --noEmit   # Type check without emitting
```

- Tests live in `tests/` and use [vitest](https://vitest.dev/)
- Write tests for new server-side logic (filesystem, config, security, detection)
- The toolbar runs in the browser and is tested manually with a dev server

---

## Pull Request Process

1. **Fork** the repo and create a branch from `main`
2. Make your changes — keep PRs focused (one feature or fix per PR)
3. Make sure all checks pass:
   ```bash
   npm run build
   npm test
   npx tsc --noEmit
   ```
4. Test manually with a real dev server if you changed proxy/toolbar/LLM logic
5. Fill out the PR template
6. Submit against `main`

### Commit messages

Use a short descriptive subject line. Examples:
- `Fix WebSocket reconnect when server restarts`
- `Add Mistral provider with Codestral model`
- `Update toolbar screenshot capture for cross-origin iframes`

### What makes a good first contribution?

- Adding a new LLM provider to the registry
- Improving the toolbar UI or fixing a CSS issue
- Adding tests for untested server-side code
- Documentation improvements
- Look for issues labeled [`good first issue`](https://github.com/Kalmuraee/OpenMagic/labels/good%20first%20issue)

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
