# Contributing to OpenMagic

PRs are welcome. Bug fixes, new providers, UI work, docs, whatever you've got.

---

## Local setup

```bash
git clone https://github.com/Kalmuraee/OpenMagic.git
cd OpenMagic
npm install
npm run build
```

Start any dev server (Vite, Next.js, whatever), then point OpenMagic at it:

```bash
node dist/cli.js --port 3000
```

Your app opens at `localhost:4567` with the toolbar injected.

---

## Project structure

OpenMagic is a reverse proxy that sits between the browser and your dev server, injecting a toolbar into HTML responses.

```
src/
├── cli.ts              # CLI entry, port detection, child process management
├── proxy.ts            # http-proxy reverse proxy, streaming HTML injection
├── server.ts           # WebSocket server, file I/O, LLM routing, debug endpoint
├── filesystem.ts       # Sandboxed file read/write, path traversal protection
├── patch.ts            # Server-side atomic patch preview/apply/rollback
├── project-grounding.ts # Server-side route/component/import grounding
├── config.ts           # Atomic config persistence (~/.openmagic/config.json)
├── security.ts         # Session token generation
├── detect.ts           # Dev server auto-detection (script parsing, port scanning)
├── shared-types.ts     # WebSocket protocol types
├── llm/
│   ├── registry.ts     # 14 providers, 70+ models, all pre-configured
│   ├── models.ts       # Server-side model catalog, live fetches, static fallback
│   ├── provider-test.ts # Provider/model health checks and error classification
│   ├── proxy.ts        # Routes LLM calls to the right adapter
│   ├── prompts.ts      # System prompt and context builder
│   ├── openai.ts       # OpenAI-compatible adapter (also handles Groq, Mistral, etc.)
│   ├── anthropic.ts    # Anthropic adapter with extended thinking
│   └── google.ts       # Google Gemini adapter
├── toolbar/
│   ├── index.ts        # Main toolbar UI, Shadow DOM Web Component (~1800 lines)
│   ├── services/
│   │   ├── ws-client.ts       # WebSocket client, handshake, reconnect, streaming
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

### Why it works this way

The proxy, toolbar bundle, and WebSocket all share one HTTP server. This avoids CORS issues entirely.

The toolbar is a Web Component with a closed shadow root, so it can't clash with the host app's styles.

All click/change handlers use event delegation attached once to the root via `data-action` attributes. This prevents listener accumulation when the panel re-renders.

HTML responses are streamed through, not buffered. The toolbar script tag gets appended at the end of the stream.

When applying LLM edits, the toolbar sends typed patches to the server. The server previews all patches, rejects ambiguous or unsafe matches, applies patch groups atomically, and stores a rollback manifest for applied groups.

Project grounding is server-side first. The toolbar calls `project.ground`, which detects common frameworks, maps routes to files, follows local imports, includes co-located styles, and respects a context budget. The older toolbar heuristic remains as a fallback.

---

## Adding a new LLM provider

1. Add to the registry in `src/llm/registry.ts`:
   ```ts
   newprovider: {
     name: "New Provider",
     baseUrl: "https://api.newprovider.com/v1",
     models: [
       { id: "model-id", name: "Model Name", maxTokens: 4096 },
     ],
   },
   ```

2. If the provider can list models, add or extend the server-side model adapter in `src/llm/models.ts`. Keep the browser toolbar out of provider-specific model fetching; it should receive provider/model data from `config.get` and `provider.models`.

3. If the provider uses an OpenAI-compatible chat API (most do), the `openai.ts` adapter handles it via the registry's `baseUrl`.

4. If the chat API is different, create `src/llm/newprovider.ts` with a `chat()` function matching the same signature as `openai.ts`, then add routing in `src/llm/proxy.ts`.

5. Add tests for static fallback and live model normalization in `tests/models.test.ts`.

6. If request payloads or streaming behavior differ, update the execution path and add request-construction tests in `tests/provider-execution.test.ts`.

---

## Working on the toolbar

The toolbar code is in `src/toolbar/index.ts`.

`buildStaticDOM()` returns the HTML string. It runs once. After that, functions like `updateStatusDot()` and `refreshPanelContent()` update specific elements rather than rebuilding everything.

To add a new button: put `data-action="your-action"` on it in `buildStaticDOM()`, then add a case for it in `handleAction()`.

Styles go in `src/toolbar/styles/toolbar.css.ts`. It's a string that gets injected into the shadow root.

Icons are SVGs defined in the `ICON` object at the top of `index.ts`. No emojis in the toolbar UI (the `✨OpenMagic🪄` brand text is the only exception).

---

## Code style

TypeScript strict mode is on and ESLint is configured locally. Run `npm run lint` before opening a PR. Keep changes simple and direct.

---

## Testing

```bash
npm test           # vitest
npm run build      # build CLI + toolbar
npm run typecheck  # type check
npm run lint       # eslint
npm run test:smoke # proxy and toolbar injection smoke test
npm run check:pack # npm package dry run
```

Tests are in `tests/` using [vitest](https://vitest.dev/). Write tests for server-side logic (filesystem, config, security, detection, provider catalogs). The smoke test covers the built proxy, toolbar injection, and toolbar bundle syntax; still test toolbar UX manually when changing UI behavior.

---

## PR process

1. Fork the repo and branch from `main`
2. Make your changes. One feature or fix per PR.
3. Check that everything passes:
   ```bash
   npm run build
   npm test
   npm run typecheck
   npm run lint
   npm run test:smoke
   ```
4. If you changed proxy, toolbar, or LLM logic, test manually with a dev server
5. Fill out the PR template and submit against `main`

### Commit messages

Short subject line describing what changed:
- `Fix WebSocket reconnect when server restarts`
- `Add Mistral provider with Codestral model`
- `Update screenshot capture for cross-origin iframes`

### Good first contributions

- Adding a new LLM provider to the registry
- Fixing a toolbar CSS issue
- Adding tests for server-side code
- Docs improvements
- Issues labeled [`good first issue`](https://github.com/Kalmuraee/OpenMagic/labels/good%20first%20issue)

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
