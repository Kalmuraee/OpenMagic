# Security Policy

OpenMagic is a local development tool. It is designed to run on `localhost`, proxy a dev server, inject a toolbar, and let that toolbar request local file and provider actions through an authenticated WebSocket.

## Threat Model

OpenMagic trusts:

- the local machine running the CLI
- the project roots passed to OpenMagic
- the proxied dev app enough to run the injected toolbar in the same page

OpenMagic does not try to make an untrusted website safe. Avoid using it with pages that load untrusted third-party scripts, remote user content, or production apps.

## Localhost Boundary

The server rejects non-local WebSocket origins and requires a session token before handling file, config, model, debug, or LLM operations. The token protects against cross-origin pages connecting to the local server, but same-page scripts in the proxied app share the page execution environment.

## API Keys

Provider API keys are stored in the local OpenMagic config and are used only by the local Node.js server. The toolbar receives provider names, model metadata, and key-present booleans; it must not receive raw API key values.

## Filesystem Access

OpenMagic limits file operations to configured project roots and rejects path traversal. Treat configured roots as sensitive: the model can propose edits and the toolbar can request writes after user action.

## Reporting Vulnerabilities

Please report security issues privately by emailing the maintainer listed in `package.json`, or by opening a GitHub security advisory if available. Include:

- affected version or commit
- reproduction steps
- impact and reachable operations
- whether the issue requires a malicious page, malicious model output, or local access

Do not publish exploit details until a fix is available.
