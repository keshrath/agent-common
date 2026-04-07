import { describe, it, expect } from 'vitest';
import { createDb, type Migration } from '../src/storage/database.js';
import { CleanupService } from '../src/domain/cleanup.js';

const migrations: Migration[] = [
  {
    version: 1,
    up: (raw) =>
      raw.exec(
        `CREATE TABLE items (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      ),
  },
];

class TestCleanup extends CleanupService<{ items: number }> {
  get resetCalled(): number {
    return TestCleanup.counter;
  }
  static counter = 0;
  override resetOnStartup(): void {
    TestCleanup.counter++;
  }
  run() {
    const items = this.db.run(`DELETE FROM items WHERE created_at < datetime('now', ?)`, [
      `-${this.retentionDays} days`,
    ]).changes;
    return { items };
  }
}

describe('CleanupService', () => {
  it('calls resetOnStartup and runs immediately', () => {
    TestCleanup.counter = 0;
    const db = createDb({ path: ':memory:', migrations });
    const svc = new TestCleanup(db, { retentionDays: 1, intervalMs: 60_000 });
    expect(svc.resetCalled).toBe(1);
    svc.stopTimer();
    db.close();
  });

  it('purges rows older than retention', () => {
    const db = createDb({ path: ':memory:', migrations });
    db.run(`INSERT INTO items (created_at) VALUES (datetime('now', '-30 days'))`);
    db.run(`INSERT INTO items (created_at) VALUES (datetime('now'))`);
    const svc = new TestCleanup(db, { retentionDays: 7, autoStart: false });
    const stats = svc.purgeAll();
    expect(stats.items).toBe(1);
    expect(db.queryAll(`SELECT * FROM items`)).toHaveLength(1);
    db.close();
  });

  it('autoStart: false skips reset and timer', () => {
    TestCleanup.counter = 0;
    const db = createDb({ path: ':memory:', migrations });
    new TestCleanup(db, { autoStart: false });
    expect(TestCleanup.counter).toBe(0);
    db.close();
  });
});
