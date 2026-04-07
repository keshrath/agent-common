// =============================================================================
// agent-common — Storage layer
//
// Generic better-sqlite3 wrapper with WAL pragmas, transactions, and a
// version-based migration runner. Consumers supply their own migrations and
// resolve their own DB path.
// =============================================================================

import Database from 'better-sqlite3';

export interface Db {
  readonly raw: Database.Database;
  run(sql: string, params?: unknown[]): Database.RunResult;
  queryAll<T>(sql: string, params?: unknown[]): T[];
  queryOne<T>(sql: string, params?: unknown[]): T | null;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface Migration {
  /** 1-based version number; migrations run in ascending order. */
  version: number;
  /** Idempotent SQL or programmatic step. */
  up: (raw: Database.Database) => void;
}

export interface DbOptions {
  /** Use ':memory:' for tests, or an absolute file path. */
  path: string;
  /** Migrations to apply on open. */
  migrations?: Migration[];
  /** Enable verbose logging to stderr. */
  verbose?: boolean;
}

export function createDb(options: DbOptions): Db {
  const raw = new Database(options.path, {
    verbose: options.verbose ? (msg) => process.stderr.write(`[sql] ${msg}\n`) : undefined,
  });

  raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('foreign_keys = ON');

  if (options.migrations && options.migrations.length > 0) {
    runMigrations(raw, options.migrations);
  }

  return {
    raw,
    run(sql, params) {
      const stmt = raw.prepare(sql);
      return params?.length ? stmt.run(...params) : stmt.run();
    },
    queryAll<T>(sql: string, params?: unknown[]): T[] {
      const stmt = raw.prepare(sql);
      return (params?.length ? stmt.all(...params) : stmt.all()) as T[];
    },
    queryOne<T>(sql: string, params?: unknown[]): T | null {
      const stmt = raw.prepare(sql);
      const row = params?.length ? stmt.get(...params) : stmt.get();
      return (row as T) ?? null;
    },
    transaction<T>(fn: () => T): T {
      return raw.transaction(fn)();
    },
    close() {
      try {
        raw.close();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

export function runMigrations(raw: Database.Database, migrations: Migration[]): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const row = raw.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  const currentVersion = row ? parseInt(row.value, 10) : 0;

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const target = sorted.length > 0 ? sorted[sorted.length - 1].version : 0;

  for (const m of sorted) {
    if (m.version > currentVersion) {
      m.up(raw);
    }
  }

  raw
    .prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`)
    .run(String(target));
}

export function getSchemaVersion(raw: Database.Database): number {
  const row = raw.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}
