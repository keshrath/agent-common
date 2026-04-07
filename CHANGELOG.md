# Changelog

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
