import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { startDashboard, type DashboardServer } from '../src/dashboard.js';
import { createRouter, json, readBody } from '../src/transport/rest.js';
import { setupWebSocket } from '../src/transport/ws.js';
import { createRequestGuard } from '../src/transport/guard.js';

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let dashboard: DashboardServer;
let port: number;
let posted = 0;

function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          Host: `localhost:${port}`,
          ...(body !== undefined ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function openWs(headers: Record<string, string>): Promise<'open' | 'rejected'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', () => resolve('rejected'));
    ws.on('error', () => resolve('rejected'));
  });
}

beforeAll(async () => {
  const router = createRouter();
  router.route('GET', '/api/ping', (_req, res) => json(res, { ok: true }));
  router.route('POST', '/api/thing', async (req, res) => {
    await readBody(req);
    posted++;
    json(res, { ok: true });
  });
  dashboard = await startDashboard({
    port: 0,
    handler: (req, res) => router.handle(req, res),
    onListen: (httpServer) =>
      setupWebSocket({
        httpServer,
        getFingerprints: () => ({}),
        getCategoryData: () => ({}),
        getFullState: () => ({}),
      }),
    banner: () => '',
  });
  port = (dashboard.httpServer.address() as AddressInfo).port;
});

afterAll(() => dashboard.close());

describe('startDashboard bind', () => {
  it('binds loopback by default, not all interfaces', () => {
    expect((dashboard.httpServer.address() as AddressInfo).address).toBe('127.0.0.1');
  });
});

describe('request guard over HTTP', () => {
  const jsonType = { 'Content-Type': 'application/json' };

  it('accepts a same-origin JSON POST', async () => {
    const before = posted;
    const res = await send(
      'POST',
      '/api/thing',
      { ...jsonType, Origin: `http://localhost:${port}` },
      '{}',
    );
    expect(res.status).toBe(200);
    expect(posted).toBe(before + 1);
  });

  it('accepts a POST without Origin (CLI / Electron file:// fetch)', async () => {
    const res = await send('POST', '/api/thing', jsonType, '{}');
    expect(res.status).toBe(200);
  });

  it('rejects a cross-origin POST', async () => {
    const before = posted;
    const res = await send('POST', '/api/thing', { ...jsonType, Origin: 'https://evil.com' }, '{}');
    expect(res.status).toBe(403);
    expect(posted).toBe(before);
  });

  it('rejects a localhost.evil.com origin', async () => {
    const res = await send(
      'POST',
      '/api/thing',
      { ...jsonType, Origin: 'http://localhost.evil.com' },
      '{}',
    );
    expect(res.status).toBe(403);
  });

  it('rejects the null origin', async () => {
    const res = await send('POST', '/api/thing', { ...jsonType, Origin: 'null' }, '{}');
    expect(res.status).toBe(403);
  });

  it('rejects a text/plain body', async () => {
    const before = posted;
    const res = await send('POST', '/api/thing', { 'Content-Type': 'text/plain' }, '{}');
    expect(res.status).toBe(415);
    expect(posted).toBe(before);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const res = await send('GET', '/api/ping', { Host: `evil.com:${port}` });
    expect(res.status).toBe(403);
  });

  it('never sends a wildcard CORS header', async () => {
    const res = await send('GET', '/api/ping');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reflects an allowed loopback origin and answers its preflight', async () => {
    const origin = 'http://127.0.0.1:3000';
    const res = await send('OPTIONS', '/api/thing', { Origin: origin });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('rejects a preflight from a foreign origin', async () => {
    const res = await send('OPTIONS', '/api/thing', { Origin: 'https://evil.com' });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request guard over WebSocket', () => {
  it('accepts a loopback origin', async () => {
    expect(await openWs({ Origin: `http://localhost:${port}` })).toBe('open');
  });

  it('accepts the Electron file:// origin', async () => {
    expect(await openWs({ Origin: 'file://' })).toBe('open');
  });

  it('rejects a foreign origin', async () => {
    expect(await openWs({ Origin: 'https://evil.com' })).toBe('rejected');
  });

  it('rejects a foreign Host header', async () => {
    expect(await openWs({ Host: 'evil.com' })).toBe('rejected');
  });
});

describe('createRequestGuard', () => {
  it('admits configured extra origins exactly', () => {
    const guard = createRequestGuard({ allowedOrigins: ['https://tool.example'] });
    expect(guard.checkOrigin('https://tool.example', 'localhost:1')).toBe(true);
    expect(guard.checkOrigin('https://tool.example.evil.com', 'localhost:1')).toBe(false);
  });

  it('admits the bound LAN host and its same-origin UI only', () => {
    const guard = createRequestGuard({ bindHost: '192.168.1.5' });
    expect(guard.checkHost('192.168.1.5:3421')).toBe(true);
    expect(guard.checkHost('evil.com:3421')).toBe(false);
    expect(guard.checkOrigin('http://192.168.1.5:3421', '192.168.1.5:3421')).toBe(true);
    expect(guard.checkOrigin('http://192.168.1.6:3421', '192.168.1.5:3421')).toBe(false);
  });

  it('accepts any Host when bound to a wildcard address', () => {
    expect(createRequestGuard({ bindHost: '0.0.0.0' }).checkHost('box.lan:3421')).toBe(true);
  });

  it('rejects missing and malformed Host headers', () => {
    const guard = createRequestGuard();
    expect(guard.checkHost(undefined)).toBe(false);
    expect(guard.checkHost('evil.com@localhost')).toBe(false);
    expect(guard.checkHost('[::1]:3421')).toBe(true);
  });
});
