<div align="center">

<img src="https://raw.githubusercontent.com/Kalmuraee/OpenMagic/main/docs/logo.png" alt="OpenMagic" width="200" />

# OpenMagic

**Add an AI coding toolbar to any web app. One command. Zero code changes.**

[![npm version](https://img.shields.io/npm/v/openmagic.svg?style=flat-square)](https://www.npmjs.com/package/openmagic)
[![npm downloads](https://img.shields.io/npm/dw/openmagic?style=flat-square)](https://www.npmjs.com/package/openmagic)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/Kalmuraee/OpenMagic?style=flat-square)](https://github.com/Kalmuraee/OpenMagic/stargazers)
[![CI](https://img.shields.io/github/actions/workflow/status/Kalmuraee/OpenMagic/ci.yml?style=flat-square&label=CI)](https://github.com/Kalmuraee/OpenMagic/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/Kalmuraee/OpenMagic/pulls)
[![Node](https://img.shields.io/node/v/openmagic?style=flat-square)](https://nodejs.org/)
[![Hits](https://hits.sh/github.com/Kalmuraee/OpenMagic.svg?style=flat-square&label=views&color=6c5ce7)](https://hits.sh/github.com/Kalmuraee/OpenMagic/)

OpenMagic injects a floating AI toolbar into your running web app via reverse proxy.
Select any element, describe what you want, review the diff, approve — your code updates and HMR refreshes the page.
No framework plugin. No IDE extension. No account. Bring your own API key.

[Website](https://kalmuraee.github.io/OpenMagic/) &#183; [Quick Start](#quick-start) &#183; [How It Works](#how-it-works) &#183; [Providers](#supported-providers) &#183; [GitHub](https://github.com/Kalmuraee/OpenMagic)

</div>

---

<div align="center">

![OpenMagic Demo](https://raw.githubusercontent.com/Kalmuraee/OpenMagic/main/docs/demo.gif)

</div>

---

## Quick Start

```bash
# 1. Start your dev server as usual
npm run dev

# 2. In your project folder, run OpenMagic (auto-detects your dev server)
npx openmagic@latest
```

Run `npx openmagic@latest` from your project folder so it can find your source files and dev server. A proxied version of your app opens with the AI toolbar overlaid. That is it.

---

## Features

| | Feature | Description |
|---|---------|-------------|
| **Select** | Element Selection | Click any element to capture its DOM, computed styles, parent layout, siblings, React props, and component name |
| **Ground** | Smart File Grounding | Reads project files, follows import chains, auto-reads co-located stylesheets and `package.json` deps |
| **Diff** | Diff Preview | Approve or reject each change. Undo to revert. Fuzzy line matching handles indentation differences |
| **Retry** | Auto-Retry | If the LLM requests more files, OpenMagic reads them transparently and retries — no manual intervention |
| **Chat** | Markdown Chat | Streaming responses, copy buttons, session persistence across HMR reloads |
| **Net** | Network Profiling | Captures page load timing, TTFB, FCP, and flags slow resources |
| **Img** | Image Attachments | Drag-drop, paste from clipboard, or use the file picker — vision models analyze screenshots |
| **Keys** | Per-Provider Keys | Store a key for each provider. Switch models without re-entering credentials |
| **KB** | Keyboard Shortcuts | Toggle, send, close, minimize — all from the keyboard |
| **Min** | Minimize to Icon | Collapse the toolbar to a small floating button when you do not need it |

---

## How It Works

OpenMagic is a single-port reverse proxy. It sits between your browser and your dev server, injecting the toolbar script into HTML responses. Your project is never modified at install time.

```
                        +-----------------------+
                        |      Your Browser     |
                        |  localhost:4567        |
                        +---+---------------+---+
                            |               |
                      HTTP proxy        WebSocket
                            |               |
  +----------------+    +---+---------------+---+
  | Your Dev Server|    |   OpenMagic Server    |
  | localhost:3000  |<---|                       |
  +----------------+    |  File Read/Write      |
                        |  LLM API Proxy        |
                        |  (your key, localhost) |
                        +-----------------------+
```

1. **Proxy** -- All requests forward to your dev server. HTML responses get the toolbar `<script>` tag appended automatically.
2. **Toolbar** -- A Shadow DOM Web Component. Fully isolated from your app's styles.
3. **Server** -- Local Node.js process handling file I/O and proxying LLM calls. API keys never leave your machine.
4. **HMR** -- When the AI modifies source files, your dev server's hot module replacement picks up changes automatically.

Stop with `Ctrl+C`. No files modified. No dependencies added. No traces.

---

## Supported Providers

14 providers, 70+ models. All pre-configured — select a provider, pick a model, paste your key.

| Provider | Notable Models | Vision | Thinking / Reasoning |
|----------|---------------|--------|---------------------|
| **OpenAI** | GPT-5.4, GPT-5.4 Pro/Mini/Nano, o3, o4-mini, Codex Mini | Yes | reasoning_effort |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | Yes | Extended thinking (budget_tokens) |
| **Google Gemini** | Gemini 3.1 Pro, 3 Flash, 2.5 Pro, 2.5 Flash | Yes | thinking_level |
| **xAI (Grok)** | Grok 4.20, Grok 4.20 Reasoning, Grok 4.1 Fast | Yes | reasoning_effort |
| **DeepSeek** | DeepSeek V3.2, DeepSeek R1 | -- | R1: reasoning_effort |
| **Mistral** | Large 3, Small 4, Codestral, Devstral 2, Magistral | Yes | Magistral: reasoning_effort |
| **MiniMax** | MiniMax models | Varies | -- |
| **Kimi** | Kimi models | Varies | -- |
| **Qwen** | Qwen models | Varies | -- |
| **Zhipu** | Zhipu (GLM) models | Varies | -- |
| **Doubao** | Doubao models | Varies | -- |
| **Groq** | Llama 4 Scout, Llama 3.3 70B, Qwen 3 32B | Llama 4 | -- |
| **Ollama** | Any local model (free, private) | Varies | -- |
| **OpenRouter** | 200+ models from all providers | Varies | Varies |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+O` | Toggle toolbar open/close |
| `Ctrl+Enter` | Send message |
| `Escape` | Close toolbar |
| Minimize button | Collapse to floating icon |

---

## Configuration

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Dev server port to proxy | Auto-detect |
| `-l, --listen <port>` | OpenMagic proxy port | `4567` |
| `-r, --root <paths...>` | Project root directories | Current directory |
| `--host <host>` | Dev server host | `localhost` |
| `--no-open` | Do not auto-open browser | `false` |

### Multi-Repo Support

```bash
npx openmagic --port 3000 --root ./frontend --root ./backend
```

### Config File

Settings persist in `~/.openmagic/config.json` (your home directory, never in your project):

```json
{
  "provider": "anthropic",
  "model": "claude-opus-4-6",
  "apiKey": "sk-ant-..."
}
```

### Using Ollama (Free, Local)

```bash
ollama pull llama3.3
npx openmagic --port 3000
# Select "Ollama (Local)" as your provider
```

---

## Security

- **Localhost only** -- The proxy and WebSocket bind to `localhost`. Not accessible from the network.
- **Session tokens** -- Each session generates a random token. The toolbar authenticates before accessing any API.
- **Path sandboxing** -- File operations are restricted to configured root directories. Symlinks that escape the root are rejected.
- **API keys stay local** -- Keys live in `~/.openmagic/config.json`. They are proxied through the local server, never exposed to the browser or any third party.
- **Zero project modification** -- OpenMagic never touches your `package.json`, config files, or source code during installation. The toolbar exists only in the proxy layer.
- **Diff preview** -- AI-proposed changes are shown as diffs with Approve/Reject buttons. Nothing is auto-applied without your consent.

---

## Known Limitations

Honesty matters. Here is what you should know:

- **Origin change** -- Your app runs on `:3000` but is accessed via `:4567`. This can affect OAuth redirect URIs, `localStorage` isolation, and Service Worker scope. Most dev workflows are unaffected, but apps that depend on `window.location.origin` may need dev config adjustments.
- **CSP via meta tags** -- OpenMagic strips CSP response headers to allow the toolbar script, but CSP defined in `<meta>` tags cannot be modified at the proxy level and may block the toolbar on strict pages.
- **Not for production** -- OpenMagic is a development tool. Do not deploy the proxy to production.

---

## Comparison

| Feature | OpenMagic | Stagewise | Frontman | Agentation |
|---------|-----------|-----------|----------|------------|
| Install | `npx openmagic` | npm + Electron | Framework middleware | npm package |
| Framework support | Any (reverse proxy) | React, Vue, Angular, Svelte | Next.js, Astro, Vite | React |
| Code modification | Yes (diff + approve) | Yes (via IDE) | Yes | No (clipboard) |
| BYOK | Yes | Paid tiers | Yes | N/A |
| Prompt limits | None | 10 free/day | None | N/A |
| Vision | Yes | Yes | No | No |
| Network profiling | Yes | No | Server-side | No |
| Multi-repo | Yes | No | No | No |
| IDE required | No | VS Code extension | No | No |
| License | MIT | Partial | Apache 2.0 | MIT |

---

## Framework Compatibility

OpenMagic works via reverse proxy, so it supports any framework that serves HTML:

**JavaScript/TypeScript** -- React, Next.js, Vue, Nuxt, Angular, Svelte, SvelteKit, Astro, Remix, Solid, Qwik, Ember

**Server-rendered** -- Django, Flask, Rails, PHP (Laravel, WordPress)

**Static** -- Plain HTML with any HTTP server

---

## Contributing

PRs are welcome! Bug fixes, new providers, UI improvements, docs — all appreciated.

```bash
git clone https://github.com/Kalmuraee/OpenMagic.git
cd OpenMagic
npm install
npm run build
node dist/cli.js --port 3000   # Test with your dev server
```

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the full guide — architecture overview, how to add LLM providers, toolbar development, code style, and PR process.

---

## Changelog Highlights

| Version | Milestone |
|---------|-----------|
| v0.1 - v0.3 | Core reverse proxy, dev server auto-detection, initial toolbar |
| v0.4 - v0.7 | Robustness hardening, Chinese model providers, session auth |
| v0.8 - v0.10 | Complete toolbar rewrite, professional UI, security audit (19 fixes) |
| v0.11 - v0.14 | Single-port architecture, diff preview, per-provider keys, streaming |
| v0.15 - v0.17 | Network profiling, image attachments, HMR WebSocket fixes |
| v0.18 - v0.20 | Full element context (parents, siblings, React props), auto-retry grounding |
| v0.21 - v0.22 | Fuzzy diff matching, import chain following |
| v0.23 - v0.24 | Undo, keyboard shortcuts, minimize, markdown rendering, chat polish |

---

## Author

**Khalid Almuraee** ([@kalmuraee](https://github.com/kalmuraee))

## License

MIT -- Copyright (c) 2026 Khalid Almuraee. See [LICENSE](./LICENSE) for details.

---

<div align="center">

**BYOK. Any framework. Zero lock-in.**

[GitHub](https://github.com/Kalmuraee/OpenMagic) &#183; [Website](https://kalmuraee.github.io/OpenMagic/) &#183; [npm](https://www.npmjs.com/package/openmagic) &#183; [Report a Bug](https://github.com/Kalmuraee/OpenMagic/issues) &#183; [Request a Feature](https://github.com/Kalmuraee/OpenMagic/issues)

</div>
