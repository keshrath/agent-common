# agent-common

Shared foundation for `agent-*` MCP servers (`agent-comm`, `agent-tasks`, `agent-knowledge`, `agent-discover`).

## What it provides

- **storage** — better-sqlite3 wrapper with WAL pragmas, transaction helper, migration runner
- **transport/rest** — node:http router with `:param` matching, JSON helper, CORS preflight, body reader, static file serving
- **transport/ws** — WebSocket server with full-state-on-connect, DB-fingerprint polling for cross-process delta updates, ping/pong heartbeat, max-connection cap
- **transport/mcp** — JSON-RPC over stdio, tool dispatcher, `ToolDefinition` type
- **domain/events** — typed in-process EventBus with wildcard subscribers
- **domain/cleanup** — base `CleanupService` with retention timer, startup reset hook
- **dashboard** — auto-start with port leader-election (graceful skip if port in use)
- **package-meta** — runtime read of `name` + `version` from a consumer's `package.json`
- **fts** — FTS5 virtual table + trigger boilerplate, search helper with LIKE fallback

## Who uses it

Internal: the four `agent-*` MCP servers. The package is host-agnostic — no `~/.claude` paths or Claude-specific config baked in.

## License

MIT — see [LICENSE](./LICENSE).
