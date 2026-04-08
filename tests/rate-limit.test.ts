import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage } from 'http';
import { createRateLimiter, defaultGetClientId } from '../src/transport/rate-limit.js';

function fakeReq(opts: { ip?: string; xff?: string | string[] } = {}): IncomingMessage {
  return {
    headers: opts.xff !== undefined ? { 'x-forwarded-for': opts.xff } : {},
    socket: { remoteAddress: opts.ip ?? '10.0.0.1' },
  } as unknown as IncomingMessage;
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the default limit and blocks past it', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 3, windowMs: 60_000 } },
      cleanupIntervalMs: 0,
    });
    const req = fakeReq({ ip: '1.1.1.1' });

    expect(rl.check(req).allowed).toBe(true);
    expect(rl.check(req).allowed).toBe(true);
    const third = rl.check(req);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = rl.check(req);
    expect(fourth.allowed).toBe(false);
    expect(fourth.limit).toBe(3);
    rl.dispose();
  });

  it('tracks separate counts per client id', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 1, windowMs: 60_000 } },
      cleanupIntervalMs: 0,
    });
    expect(rl.check(fakeReq({ ip: 'a' })).allowed).toBe(true);
    expect(rl.check(fakeReq({ ip: 'b' })).allowed).toBe(true);
    expect(rl.check(fakeReq({ ip: 'a' })).allowed).toBe(false);
    expect(rl.check(fakeReq({ ip: 'b' })).allowed).toBe(false);
    rl.dispose();
  });

  it('resets after the window elapses', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 1, windowMs: 1_000 } },
      cleanupIntervalMs: 0,
    });
    const req = fakeReq({ ip: 'x' });
    expect(rl.check(req).allowed).toBe(true);
    expect(rl.check(req).allowed).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(rl.check(req).allowed).toBe(true);
    rl.dispose();
  });

  it('heavy bucket is independent of default bucket', () => {
    const rl = createRateLimiter({
      windows: {
        default: { max: 100, windowMs: 60_000 },
        heavy: { max: 2, windowMs: 60_000 },
      },
      cleanupIntervalMs: 0,
    });
    const req = fakeReq({ ip: 'h' });

    expect(rl.check(req, 'heavy').allowed).toBe(true);
    expect(rl.check(req, 'heavy').allowed).toBe(true);
    expect(rl.check(req, 'heavy').allowed).toBe(false);

    expect(rl.check(req, 'default').allowed).toBe(true);
    rl.dispose();
  });

  it('falls back to default window when heavy not configured', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 1, windowMs: 60_000 } },
      cleanupIntervalMs: 0,
    });
    const req = fakeReq({ ip: 'fb' });
    expect(rl.check(req, 'heavy').allowed).toBe(true);
    expect(rl.check(req, 'heavy').allowed).toBe(false);
    rl.dispose();
  });

  it('uses custom getClientId when provided', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 1, windowMs: 60_000 } },
      cleanupIntervalMs: 0,
      getClientId: (req) => (req.headers['x-api-key'] as string) ?? 'anon',
    });
    const a = { headers: { 'x-api-key': 'KEY1' }, socket: {} } as unknown as IncomingMessage;
    const b = { headers: { 'x-api-key': 'KEY2' }, socket: {} } as unknown as IncomingMessage;
    expect(rl.check(a).allowed).toBe(true);
    expect(rl.check(a).allowed).toBe(false);
    expect(rl.check(b).allowed).toBe(true);
    rl.dispose();
  });

  it('cleanup timer sweeps expired entries', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 5, windowMs: 1_000 } },
      cleanupIntervalMs: 2_000,
    });
    rl.check(fakeReq({ ip: 'sweep-1' }));
    rl.check(fakeReq({ ip: 'sweep-2' }));

    vi.advanceTimersByTime(1_500);
    vi.advanceTimersByTime(2_000);
    rl.dispose();
  });

  it('throws when windows.default is missing', () => {
    expect(() =>
      createRateLimiter({
        windows: {} as unknown as { default: { max: number; windowMs: number } },
      }),
    ).toThrow();
  });

  it('dispose is idempotent', () => {
    const rl = createRateLimiter({
      windows: { default: { max: 1, windowMs: 1_000 } },
      cleanupIntervalMs: 1_000,
    });
    rl.dispose();
    expect(() => rl.dispose()).not.toThrow();
  });
});

describe('defaultGetClientId', () => {
  it('prefers x-forwarded-for first hop', () => {
    expect(defaultGetClientId(fakeReq({ ip: '127.0.0.1', xff: '203.0.113.5, 10.0.0.1' }))).toBe(
      '203.0.113.5',
    );
  });

  it('handles array x-forwarded-for', () => {
    expect(defaultGetClientId(fakeReq({ ip: '127.0.0.1', xff: ['198.51.100.7'] }))).toBe(
      '198.51.100.7',
    );
  });

  it('falls back to socket.remoteAddress', () => {
    expect(defaultGetClientId(fakeReq({ ip: '192.0.2.9' }))).toBe('192.0.2.9');
  });

  it('returns "unknown" when nothing is available', () => {
    const req = { headers: {}, socket: {} } as unknown as IncomingMessage;
    expect(defaultGetClientId(req)).toBe('unknown');
  });
});
