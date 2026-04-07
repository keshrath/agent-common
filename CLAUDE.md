# agent-common

## Architecture

```
src/
  storage/    database (better-sqlite3 + migration runner), fts (FTS5 helpers)
  transport/  rest (node:http router), ws (delta-polling WebSocket), mcp (JSON-RPC over stdio)
  domain/     events (typed EventBus), cleanup (base retention service)
  dashboard.ts        port leader-election + graceful start
  package-meta.ts     read consumer name/version from package.json
  index.ts            barrel exports
```

## Genericity rule

agent-common is **host-agnostic** — usable from Claude Code, Cursor, Codex CLI, Aider, Continue. Do NOT bake in `~/.claude` paths, schema-specific tables, or consumer types. Helpers take their dependencies via constructor injection.

## Code style

ESM, TypeScript NodeNext, ESLint + Prettier. No inline comments — file-level section headers only.

## Versioning

Single source of truth: `package.json`. `readPackageMeta` reads it at runtime. Every release bumps the version and gets a git tag (`vX.Y.Z`) which triggers npm publish via the CI workflow.

## Build & test

```
npm run build      # tsc
npm test           # vitest
npm run check      # typecheck + lint + format + test
```
