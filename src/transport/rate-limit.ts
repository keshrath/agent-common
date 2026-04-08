// =============================================================================
// agent-common — Rate limiter
//
// IP-keyed fixed-window rate limiter with optional secondary "heavy" bucket
// for expensive endpoints. Single instance manages both buckets, lazy
// cleanup of expired entries on a timer (timer is unref'd so it doesn't
// keep the event loop alive).
// =============================================================================

import type { IncomingMessage } from 'http';

export interface RateLimitWindow {
  max: number;
  windowMs: number;
}

export interface RateLimitWindows {
  default: RateLimitWindow;
  heavy?: RateLimitWindow;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export type RateLimitBucketName = 'default' | 'heavy';

export interface RateLimiterOptions {
  windows: RateLimitWindows;
  /** How often to sweep expired entries from the bucket maps. Default: 5 minutes. */
  cleanupIntervalMs?: number;
  /** Extract the client identifier (default: x-forwarded-for first, then remoteAddress). */
  getClientId?: (req: IncomingMessage) => string;
}

export interface RateLimiter {
  check(req: IncomingMessage, bucket?: RateLimitBucketName): RateLimitResult;
  /** Stop the cleanup timer. Safe to call multiple times. */
  dispose(): void;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60_000;

export function defaultGetClientId(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  if (!options.windows?.default) {
    throw new Error('createRateLimiter: windows.default is required');
  }

  const getClientId = options.getClientId ?? defaultGetClientId;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

  const buckets: Record<RateLimitBucketName, Map<string, BucketEntry>> = {
    default: new Map(),
    heavy: new Map(),
  };

  function sweep(): void {
    const now = Date.now();
    for (const map of [buckets.default, buckets.heavy]) {
      for (const [key, entry] of map) {
        if (entry.resetAt <= now) map.delete(key);
      }
    }
  }

  const timer: NodeJS.Timeout | null =
    cleanupIntervalMs > 0 ? setInterval(sweep, cleanupIntervalMs) : null;
  if (timer && typeof timer.unref === 'function') timer.unref();

  function check(
    req: IncomingMessage,
    bucketName: RateLimitBucketName = 'default',
  ): RateLimitResult {
    const window =
      bucketName === 'heavy'
        ? (options.windows.heavy ?? options.windows.default)
        : options.windows.default;
    const map = buckets[bucketName];
    const id = getClientId(req);
    const now = Date.now();

    let entry = map.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + window.windowMs };
      map.set(id, entry);
    }

    entry.count++;
    const remaining = Math.max(0, window.max - entry.count);
    return {
      allowed: entry.count <= window.max,
      remaining,
      resetAt: entry.resetAt,
      limit: window.max,
    };
  }

  function dispose(): void {
    if (timer) clearInterval(timer);
    buckets.default.clear();
    buckets.heavy.clear();
  }

  return { check, dispose };
}
