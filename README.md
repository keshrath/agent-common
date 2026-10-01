# agent-common

Shared foundation for `agent-*` MCP servers (`agent-comm`, `agent-tasks`, `agent-knowledge`, `agent-discover`).

## What it provides

- **storage** — better-sqlite3 wrapper with WAL pragmas, transaction helper, migration runner
- **transport/rest** — node:http router with `:param` matching, JSON helper, body reader, static file serving
- **transport/guard** — shared request policy: loopback-only `Host` (DNS rebinding), loopback / same-origin / `file://` `Origin` (no wildcard CORS, `null` rejected), `application/json` required for state-changing bodies
- **transport/ws** — WebSocket server with full-state-on-connect, DB-fingerprint polling for cross-process delta updates, ping/pong heartbeat, max-connection cap
- **transport/mcp** — JSON-RPC over stdio, tool dispatcher, `ToolDefinition` type
- **domain/events** — typed in-process EventBus with wildcard subscribers
- **domain/cleanup** — base `CleanupService` with retention timer, startup reset hook
- **dashboard** — auto-start with port leader-election (graceful skip if port in use); binds `127.0.0.1` and guards every request and WebSocket upgrade
- **package-meta** — runtime read of `name` + `version` from a consumer's `package.json`
- **fts** — FTS5 virtual table + trigger boilerplate, search helper with LIKE fallback

## Network exposure

Dashboards bind `127.0.0.1` by default. Consumers expose an opt-in override as `AGENT_<NAME>_HOST` (e.g. `AGENT_COMM_HOST=0.0.0.0`) and pass it to `startDashboard({ host })`. A specific non-loopback address is added to the accepted `Host` names; a wildcard address accepts any `Host`, so only use it on a trusted network. Extra browser origins can be admitted with `startDashboard({ allowedOrigins })`.

## Who uses it

Internal: the four `agent-*` MCP servers. The package is host-agnostic — no `~/.claude` paths or Claude-specific config baked in.

## License

MIT — see [LICENSE](./LICENSE).
