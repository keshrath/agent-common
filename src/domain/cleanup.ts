// =============================================================================
// agent-common — Cleanup service base
//
// Provides timer scheduling and a startup-reset hook. Consumers extend
// `CleanupService` and override `run()` to delete their own stale rows.
// =============================================================================

import type { Db } from '../storage/database.js';

export interface CleanupOptions {
  /** Retention period in days for the consumer's main rows. Default: 7. */
  retentionDays?: number;
  /** Interval at which `run()` is invoked. Default: 1 hour. */
  intervalMs?: number;
  /** If true, calls `resetOnStartup()` and `run()` immediately on construction. */
  autoStart?: boolean;
}

export abstract class CleanupService<S extends Record<string, number> = Record<string, number>> {
  protected readonly retentionDays: number;
  protected readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    protected readonly db: Db,
    options: CleanupOptions = {},
  ) {
    this.retentionDays = options.retentionDays ?? 7;
    this.intervalMs = options.intervalMs ?? 60 * 60 * 1000;

    if (options.autoStart !== false) {
      this.resetOnStartup();
      this.startTimer();
    }
  }

  /**
   * Override to delete stale rows. Called on startup, on the timer, and
   * via the public `purgeAll()` entry point.
   */
  abstract run(): S;

  /**
   * Override to fix up state on server start (e.g. mark agents offline).
   * Default no-op.
   */
  resetOnStartup(): void {
    /* override in consumer */
  }

  purgeAll(): S {
    return this.run();
  }

  startTimer(): void {
    if (this.timer) return;
    this.run();
    this.timer = setInterval(() => {
      try {
        this.run();
      } catch (err) {
        process.stderr.write(
          '[agent-common] Cleanup timer error: ' +
            (err instanceof Error ? err.message : String(err)) +
            '\n',
        );
      }
    }, this.intervalMs);
    this.timer.unref();
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
