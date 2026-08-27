# OpenMagic v0.45.0 audit remediation

**Status: implemented and validated before release.**

This release resolves OM-001 through OM-033 across credential isolation, process ownership, cross-platform startup, CLI-agent lifecycle, native-edit isolation, safe Git execution, file durability, nested-DOM editing, proxy fidelity, reasoning requests, multi-root behavior, backup and manifest privacy, verification, runtime observation, image serialization, screenshot capture, stream flushing, conversation context, exact paged reads, rollback completeness, symlink refusal, encoded-response integrity, framework grounding, static SPA routing and release metadata.

## Validation gates

- Production build
- TypeScript typecheck
- ESLint
- Full unit and integration suite
- Edit-success evaluation
- CLI smoke test
- Chromium browser smoke test
- npm package inspection
- Production dependency audit
- Linux, macOS and Windows pull-request CI

npm and GitHub publication occur only after the validated pull request is merged to `main`; the independent release workflow repeats all release gates before publishing.
