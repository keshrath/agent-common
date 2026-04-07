import { describe, it, expect } from 'vitest';
import { createDb, getSchemaVersion, type Migration } from '../src/storage/database.js';

const migrations: Migration[] = [
  {
    version: 1,
    up: (raw) => raw.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`),
  },
  {
    version: 2,
    up: (raw) => raw.exec(`ALTER TABLE items ADD COLUMN qty INTEGER DEFAULT 0`),
  },
];

describe('createDb', () => {
  it('runs migrations to the latest version', () => {
    const db = createDb({ path: ':memory:', migrations });
    expect(getSchemaVersion(db.raw)).toBe(2);
    db.close();
  });

  it('run/queryOne/queryAll round-trip', () => {
    const db = createDb({ path: ':memory:', migrations });
    db.run(`INSERT INTO items (name, qty) VALUES (?, ?)`, ['apple', 3]);
    db.run(`INSERT INTO items (name, qty) VALUES (?, ?)`, ['banana', 7]);
    const all = db.queryAll<{ id: number; name: string; qty: number }>(
      `SELECT * FROM items ORDER BY id`,
    );
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('apple');
    const one = db.queryOne<{ name: string }>(`SELECT name FROM items WHERE qty = ?`, [7]);
    expect(one?.name).toBe('banana');
    db.close();
  });

  it('skips already-applied migrations', () => {
    const db1 = createDb({ path: ':memory:', migrations });
    expect(getSchemaVersion(db1.raw)).toBe(2);
    db1.close();
  });

  it('transaction rolls back on throw', () => {
    const db = createDb({ path: ':memory:', migrations });
    expect(() =>
      db.transaction(() => {
        db.run(`INSERT INTO items (name) VALUES ('x')`);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.queryAll(`SELECT * FROM items`)).toHaveLength(0);
    db.close();
  });
});
