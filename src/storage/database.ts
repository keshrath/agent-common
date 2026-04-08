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
  /**
   * If true, before running migrations, seed _meta.schema_version from the
   * legacy `pragma user_version` value when _meta is empty and user_version > 0.
   * Use this when adopting agent-common's migration runner on an existing DB
   * that previously tracked its schema version via pragma user_version.
   */
  adoptUserVersion?: boolean;
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
    runMigrations(raw, options.migrations, { adoptUserVersion: options.adoptUserVersion });
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

export interface RunMigrationsOptions {
  /**
   * If true, seed _meta.schema_version from `pragma user_version` when _meta
   * is empty and user_version > 0. Lets consumers adopt the runner on legacy
   * DBs without re-running migrations against tables that already exist.
   */
  adoptUserVersion?: boolean;
}

export function runMigrations(
  raw: Database.Database,
  migrations: Migration[],
  options: RunMigrationsOptions = {},
): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  let row = raw.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;

  if (!row && options.adoptUserVersion) {
    const userVersion = raw.pragma('user_version', { simple: true }) as number;
    if (typeof userVersion === 'number' && userVersion > 0) {
      raw
        .prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', ?)`)
        .run(String(userVersion));
      row = { value: String(userVersion) };
    }
  }

  const currentVersion = row ? parseInt(row.value, 10) : 0;

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const target = sorted.length > 0 ? sorted[sorted.length - 1].version : 0;

  const applyAll = raw.transaction(() => {
    for (const m of sorted) {
      if (m.version > currentVersion) {
        m.up(raw);
        raw
          .prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`)
          .run(String(m.version));
      }
    }
    raw
      .prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`)
      .run(String(target));
  });
  applyAll();
}

export function getSchemaVersion(raw: Database.Database): number {
  const row = raw.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

// ---------------------------------------------------------------------------
// Idempotent schema helpers
// ---------------------------------------------------------------------------

/**
 * ALTER TABLE ADD COLUMN guarded by a PRAGMA table_info check. No-op if the
 * column already exists. Saves boilerplate in migrations that need to remain
 * safe to re-run on partially-migrated DBs.
 */
export function addColumnIfMissing(
  raw: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Returns true if the given column exists on the given table.
 */
export function hasColumn(raw: Database.Database, table: string, column: string): boolean {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}
