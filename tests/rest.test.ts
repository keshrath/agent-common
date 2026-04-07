import { describe, it, expect } from 'vitest';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { createRouter, json } from '../src/transport/rest.js';
import { ValidationError } from '../src/types.js';

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  routerSetup: (r: ReturnType<typeof createRouter>) => void,
): Promise<T> {
  const router = createRouter();
  routerSetup(router);
  const server = createServer((req, res) => {
    router.handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('createRouter', () => {
  it('matches static routes and returns JSON', async () => {
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/hello`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ msg: 'hi' });
      },
      (r) => r.route('GET', '/api/hello', (_req, res) => json(res, { msg: 'hi' })),
    );
  });

  it('extracts :param values', async () => {
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/items/42`);
        expect(await res.json()).toEqual({ id: '42' });
      },
      (r) => r.route('GET', '/api/items/:id', (_req, res, params) => json(res, { id: params.id })),
    );
  });

  it('returns 404 for unmatched /api routes', async () => {
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/missing`);
        expect(res.status).toBe(404);
      },
      () => {},
    );
  });

  it('maps KitError to its statusCode', async () => {
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/boom`);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('VALIDATION_ERROR');
      },
      (r) =>
        r.route('GET', '/api/boom', () => {
          throw new ValidationError('nope');
        }),
    );
  });

  it('handles OPTIONS preflight', async () => {
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/api/anything`, { method: 'OPTIONS' });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      },
      () => {},
    );
  });
});
