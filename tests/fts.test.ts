import { describe, it, expect } from 'vitest';
import { createDb, type Migration } from '../src/storage/database.js';
import { createFtsTable, ftsSearch } from '../src/storage/fts.js';

const migrations: Migration[] = [
  {
    version: 1,
    up: (raw) => raw.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`),
  },
];

describe('fts helpers', () => {
  it('creates an FTS table and finds matches', () => {
    const db = createDb({ path: ':memory:', migrations });
    createFtsTable(db, { ftsTable: 'notes_fts', contentTable: 'notes', column: 'body' });
    db.run(`INSERT INTO notes (body) VALUES ('hello world')`);
    db.run(`INSERT INTO notes (body) VALUES ('goodbye world')`);
    db.run(`INSERT INTO notes (body) VALUES ('something else')`);

    const results = ftsSearch<{ id: number; body: string }>(db, {
      ftsTable: 'notes_fts',
      contentTable: 'notes',
      column: 'body',
      query: 'world',
    });
    expect(results).toHaveLength(2);
    db.close();
  });

  it('honors limit parameter', () => {
    const db = createDb({ path: ':memory:', migrations });
    createFtsTable(db, { ftsTable: 'notes_fts', contentTable: 'notes', column: 'body' });
    for (let i = 0; i < 5; i++) {
      db.run(`INSERT INTO notes (body) VALUES (?)`, [`item ${i}`]);
    }
    const results = ftsSearch<{ id: number; body: string }>(db, {
      ftsTable: 'notes_fts',
      contentTable: 'notes',
      column: 'body',
      query: 'item',
      limit: 2,
    });
    expect(results).toHaveLength(2);
    db.close();
  });
});
