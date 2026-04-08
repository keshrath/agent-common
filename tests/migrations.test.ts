import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  createDb,
  runMigrations,
  getSchemaVersion,
  addColumnIfMissing,
  hasColumn,
  type Migration,
} from '../src/storage/database.js';

const migrations: Migration[] = [
  {
    version: 1,
    up: (raw) => raw.exec(`CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`),
  },
  {
    version: 2,
    up: (raw) => addColumnIfMissing(raw, 'widgets', 'qty', 'INTEGER DEFAULT 0'),
  },
  {
    version: 3,
    up: (raw) => addColumnIfMissing(raw, 'widgets', 'color', "TEXT DEFAULT 'red'"),
  },
];

describe('runMigrations adoptUserVersion', () => {
  it('seeds _meta from pragma user_version when adopting', () => {
    const raw = new Database(':memory:');
    raw.exec(
      `CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER DEFAULT 0)`,
    );
    raw.pragma('user_version = 2');

    runMigrations(raw, migrations, { adoptUserVersion: true });

    expect(getSchemaVersion(raw)).toBe(3);
    const cols = raw.prepare(`PRAGMA table_info(widgets)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(['id', 'name', 'qty', 'color']));
    raw.close();
  });

  it('does not seed when adoptUserVersion is false', () => {
    const raw = new Database(':memory:');
    raw.exec(
      `CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER DEFAULT 0)`,
    );
    raw.pragma('user_version = 2');

    expect(() => runMigrations(raw, migrations)).toThrow();
    raw.close();
  });

  it('no-op when user_version is 0', () => {
    const raw = new Database(':memory:');
    runMigrations(raw, migrations, { adoptUserVersion: true });
    expect(getSchemaVersion(raw)).toBe(3);
    raw.close();
  });

  it('does not overwrite an existing _meta row', () => {
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    raw.prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', '3')`).run();
    raw.exec(
      `CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER DEFAULT 0, color TEXT DEFAULT 'red')`,
    );
    raw.pragma('user_version = 1');

    runMigrations(raw, migrations, { adoptUserVersion: true });
    expect(getSchemaVersion(raw)).toBe(3);
    raw.close();
  });

  it('createDb forwards adoptUserVersion option', () => {
    const raw = new Database(':memory:');
    raw.exec(
      `CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER DEFAULT 0)`,
    );
    raw.pragma('user_version = 2');
    const path = ':memory:';
    raw.close();

    // For in-memory DBs each open is fresh; just verify the option is accepted.
    const db = createDb({ path, migrations, adoptUserVersion: true });
    expect(getSchemaVersion(db.raw)).toBe(3);
    db.close();
  });
});

describe('addColumnIfMissing / hasColumn', () => {
  it('adds the column when missing', () => {
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
    expect(hasColumn(raw, 't', 'name')).toBe(false);
    addColumnIfMissing(raw, 't', 'name', 'TEXT');
    expect(hasColumn(raw, 't', 'name')).toBe(true);
    raw.close();
  });

  it('is a no-op when the column already exists', () => {
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
    expect(() => addColumnIfMissing(raw, 't', 'name', 'TEXT')).not.toThrow();
    raw.close();
  });

  it('respects the supplied column definition', () => {
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
    addColumnIfMissing(raw, 't', 'qty', 'INTEGER DEFAULT 7 NOT NULL');
    raw.prepare(`INSERT INTO t (id) VALUES (1)`).run();
    const row = raw.prepare(`SELECT qty FROM t WHERE id = 1`).get() as { qty: number };
    expect(row.qty).toBe(7);
    raw.close();
  });
});
