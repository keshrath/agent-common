// =============================================================================
// agent-common — FTS5 helpers
//
// Boilerplate for creating an FTS5 virtual table mirroring a content table,
// with insert/update/delete triggers, and a search helper that falls back to
// LIKE if the FTS query fails (e.g. on malformed user input).
// =============================================================================

import type { Db } from './database.js';

export interface FtsOptions {
  /** Name of the FTS5 virtual table to create (e.g. "messages_fts"). */
  ftsTable: string;
  /** Name of the content table the FTS index mirrors (e.g. "messages"). */
  contentTable: string;
  /** Column name in the content table to index (e.g. "content"). */
  column: string;
}

/** Create an FTS5 virtual table + insert/update/delete triggers idempotently. */
export function createFtsTable(db: Db, opts: FtsOptions): void {
  const { ftsTable, contentTable, column } = opts;
  db.raw.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable} USING fts5(
      ${column},
      content=${contentTable},
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS ${ftsTable}_insert AFTER INSERT ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(rowid, ${column}) VALUES (new.id, new.${column});
    END;

    CREATE TRIGGER IF NOT EXISTS ${ftsTable}_update AFTER UPDATE OF ${column} ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${column}) VALUES ('delete', old.id, old.${column});
      INSERT INTO ${ftsTable}(rowid, ${column}) VALUES (new.id, new.${column});
    END;

    CREATE TRIGGER IF NOT EXISTS ${ftsTable}_delete AFTER DELETE ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${column}) VALUES ('delete', old.id, old.${column});
    END;
  `);
}

export interface FtsSearchOptions {
  ftsTable: string;
  contentTable: string;
  column: string;
  query: string;
  limit?: number;
  /** Optional extra WHERE clause appended after the FTS join. */
  extraWhere?: string;
  extraParams?: unknown[];
}

/**
 * FTS5 MATCH search with LIKE fallback. Returns matching content rows.
 * If the FTS query parses incorrectly, falls back to a LIKE wildcard scan.
 */
export function ftsSearch<T>(db: Db, opts: FtsSearchOptions): T[] {
  const { ftsTable, contentTable, column, query, limit = 20, extraWhere, extraParams } = opts;
  const limitClause = `LIMIT ${Math.max(1, Math.min(500, limit))}`;
  const extra = extraWhere ? ` AND ${extraWhere}` : '';
  const params = [query, ...(extraParams ?? [])];

  try {
    return db.queryAll<T>(
      `SELECT ${contentTable}.* FROM ${contentTable}
       JOIN ${ftsTable} ON ${ftsTable}.rowid = ${contentTable}.id
       WHERE ${ftsTable} MATCH ?${extra}
       ORDER BY ${contentTable}.id DESC
       ${limitClause}`,
      params,
    );
  } catch {
    const likeParam = `%${query}%`;
    const fallbackParams = [likeParam, ...(extraParams ?? [])];
    return db.queryAll<T>(
      `SELECT * FROM ${contentTable}
       WHERE ${column} LIKE ?${extra}
       ORDER BY id DESC
       ${limitClause}`,
      fallbackParams,
    );
  }
}
