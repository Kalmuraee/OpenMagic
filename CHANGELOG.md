# Changelog

All notable changes to OpenMagic are documented here.

## [0.24.0] - 2026-03-27
### Added
- Undo button on applied diffs (restore from backup)
- Clear chat button
- Keyboard shortcuts (Ctrl+Shift+O, Escape, Ctrl+Enter)
- Toolbar minimize to icon
- Copy button on chat messages
- Markdown rendering in chat (code blocks, bold, italic)
- Grounding feedback ("Reading files...")
- Context chips for grounded files
- Codex-reviewed accessibility (focus-visible, scoped shortcuts)

## [0.22.0] - 2026-03-27
### Added
- Import following in grounded files (auto-reads imported components)
- Increased auto-retry limit to 4 files

## [0.21.0] - 2026-03-27
### Added
- Fuzzy line-based diff matching (handles indentation differences)
- Brace-counting JSON parser (replaces greedy regex)
- Broader NEED_FILE detection (natural language patterns)
- File truncation indicators
- Improved system prompt for LLM guidance
- Smarter sibling context (±3 around selected element)

## [0.20.0] - 2026-03-27
### Added
- Auto-retry grounding: LLM requests files transparently

## [0.19.0] - 2026-03-27
### Added
- Complete element context: parent styles, siblings, CSS rules, React props
- Co-located stylesheet auto-reading
- Framework/dependency awareness from package.json
- Viewport dimensions in context

## [0.18.0] - 2026-03-27
### Added
- Full element context (CSS selector, computed styles, component ancestry)
- Smart file grounding with URL route matching (+15)
- React component detection via fiber
- Page URL and title in LLM prompt

## [0.17.0] - 2026-03-27
### Added
- Network profiling capture (page load, TTFB, FCP, slow resources)
- Image attachments (drag-drop, paste, file picker)

## [0.16.0] - 2026-03-27
### Added
- Per-provider API key storage (switch without re-entering)
- Session persistence (chat survives HMR/page refresh)
- Provider indicators (checkmark on configured providers)
- Better diff apply feedback

## [0.15.0] - 2026-03-27
### Fixed
- Port detection: project scripts checked first, AirPlay on 5000 avoided
- toolbar.js 404: query string in URL properly handled
- HMR WebSocket: removed ws:true conflict, Accept-Encoding scoped

## [0.14.0] - 2026-03-27
### Added
- Streaming HTML proxy (no more buffering, fixes SSR)
- WebSocket exponential backoff reconnect
- 16 regression tests across 4 test files
- wss:// support for HTTPS pages

## [0.13.0] - 2026-03-27
### Added
- Real grounding loop (reads source files before LLM call)
- UTF-8 safe base64 encoding
- External script injection (fixes CSP)
- Uniqueness check on diff apply

## [0.11.0] - 2026-03-27
### Changed
- **Single-port architecture** — proxy + toolbar + WebSocket on one port
- Per-provider API key storage
- ESC to cancel element selection
- Responsive toolbar width

## [0.10.0] - 2026-03-26
### Fixed
- 19 issues from Codex GPT-5.4 review (security, reliability, correctness)

## [0.8.0] - 2026-03-26
### Changed
- Complete toolbar rewrite: event delegation, targeted DOM updates
- Always-on prompt bar
- Professional SVG icons (no emojis)

## [0.6.0] - 2026-03-26
### Added
- Chinese LLM providers (MiniMax, Kimi, Qwen, Zhipu, Doubao)
- Session token authentication option

## [0.4.0] - 2026-03-26
### Added
- Smart dev server detection from package.json
- Dependency installation check (offers npm install)
- Gzip/brotli decompression in proxy

## [0.1.0] - 2026-03-26
### Added
- Initial release
- Reverse proxy architecture
- 9 LLM providers
- Element selection, screenshot capture
- WebSocket protocol for file operations
