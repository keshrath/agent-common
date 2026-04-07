# Changelog

## [1.0.2] - 2026-04-07

- `setupWebSocket`:
  - `getCategoryData(category)` now returns an object whose keys are **spread** into the delta payload. Lets consumers bundle related fields (e.g. `messages + messageCount`) under one fingerprint.
  - New optional `onMessage(ws, msg)` callback for custom client-to-server message types beyond the built-in `refresh`. Return `true` to signal the message was handled.
  - `WsHandle` now exposes `broadcast(message)` for raw-string broadcasts to all open clients.

## [1.0.1] - 2026-04-07

- `json()` accepts `options.extraHeaders` to merge custom headers (e.g. SECURITY_HEADERS) into the response.
- `serveStatic()` accepts `options.spaFallback` (default true) — set to `false` for strict 404-on-miss behavior, and `options.extraHeaders` to merge headers into 200 responses.

## [1.0.0] - 2026-04-07

Initial release of `agent-common`. Extracted shared scaffolding from `agent-comm`, `agent-tasks`, `agent-knowledge`, and `agent-discover`:

- `createDb` + migration runner (`storage/database.ts`)
- FTS5 helpers (`storage/fts.ts`)
- REST router builder (`transport/rest.ts`)
- WebSocket server with fingerprint-based delta polling (`transport/ws.ts`)
- MCP JSON-RPC dispatcher (`transport/mcp.ts`)
- `EventBus` (`domain/events.ts`)
- `CleanupService` base class (`domain/cleanup.ts`)
- `startDashboard` with port leader-election (`dashboard.ts`)
- `readPackageMeta` (`package-meta.ts`)
