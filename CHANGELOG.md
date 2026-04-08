# Changelog

## [1.1.0] - 2026-04-08

### Added

- **Rate limiter** (`transport/rate-limit.ts`) — IP-keyed fixed-window limiter
  with optional secondary `heavy` bucket for expensive endpoints. Single
  `createRateLimiter({ windows, cleanupIntervalMs?, getClientId? })` instance
  manages both buckets, lazy cleanup of expired entries via an unref'd timer,
  and exposes `check(req, bucket?)` and `dispose()`. Replaces the duplicated
  rate-limit code in `agent-tasks` and `agent-knowledge`.
- **Migration runner — `adoptUserVersion`** option on `runMigrations` (and
  forwarded by `createDb`). When set, the runner seeds `_meta.schema_version`
  from the legacy `pragma user_version` value before applying migrations,
  letting consumers adopt agent-common's runner on existing DBs without
  re-running migrations against tables that already exist. Removes the need
  for the inline pre-open shim that `agent-discover` carried.
- **`addColumnIfMissing(raw, table, column, definition)`** and
  **`hasColumn(raw, table, column)`** — idempotent ALTER TABLE ADD COLUMN
  helper backed by `PRAGMA table_info`. Saves boilerplate in any migration
  that needs to remain safe to re-run on partially-migrated DBs.

## [1.0.3] - 2026-04-07

- `startMcpServer`:
  - `handleTool` may return a Promise (async tool handlers).
  - `tools` may be a function returning the list (dynamic tool lists).
  - New `formatResult(result, toolName)` to customize tool response text (e.g. append a trailing instructions footer).
  - New `onToolCalled(name, args, notify)` post-response hook with an injected `notify(method, params)` callback for emitting JSON-RPC notifications like `notifications/tools/list_changed`.
  - New `capabilities` option to override the default `{ tools: {} }` (e.g. `{ tools: { listChanged: true } }`).
  - New `logLabel` for stderr error prefixes.
  - `McpServerHandle` now exposes `notify(method, params)`.

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
