// =============================================================================
// agent-common — REST transport
//
// Lightweight HTTP router using only node:http. Provides:
//   - route(method, path, handler) with :param matching
//   - json() helper with CORS + nosniff headers
//   - readBody() with size limit + JSON object validation
//   - serveStatic() with traversal + symlink protection
//   - createRouter() returns a request handler that dispatches routes
//     and falls back to a static file root.
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, realpathSync } from 'fs';
import { join, extname, resolve } from 'path';
import { KitError, ValidationError } from '../types.js';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export interface Router {
  route(method: string, path: string, handler: RouteHandler): void;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export interface RouterOptions {
  /** Optional static directory to serve when no API route matches. */
  staticDir?: string;
  /** Logger for handler errors (default: process.stderr). */
  logError?: (err: unknown) => void;
}

export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

export function readBody(
  req: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ValidationError('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          reject(new ValidationError('Request body must be a JSON object'));
        } else {
          resolveBody(body as Record<string, unknown>);
        }
      } catch {
        reject(new ValidationError('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

export function createRouter(options: RouterOptions = {}): Router {
  const routes: Route[] = [];
  const logError =
    options.logError ??
    ((err) => {
      process.stderr.write(
        '[agent-common] REST handler error: ' +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
    });

  function route(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const pattern = path.replace(/:(\w+)/g, (_match, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ method, pattern: new RegExp(`^${pattern}$`), paramNames, handler });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = pathname.match(r.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      try {
        await r.handler(req, res, params);
      } catch (err) {
        if (err instanceof KitError) {
          json(res, { error: err.message, code: err.code }, err.statusCode);
        } else {
          logError(err);
          json(res, { error: 'Internal server error' }, 500);
        }
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      json(res, { error: 'Not found' }, 404);
      return;
    }

    if (options.staticDir) {
      serveStatic(res, options.staticDir, pathname === '/' ? '/index.html' : pathname);
      return;
    }

    json(res, { error: 'Not found' }, 404);
  }

  return { route, handle };
}

export function serveStatic(res: ServerResponse, baseDir: string, pathname: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (decoded.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decoded)) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  let realBase: string;
  try {
    realBase = realpathSync(baseDir);
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const filePath = resolve(join(baseDir, decoded));
  if (!filePath.startsWith(realBase)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let realFilePath: string;
  try {
    realFilePath = realpathSync(filePath);
  } catch {
    realFilePath = filePath;
  }

  if (!realFilePath.startsWith(realBase)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = readFileSync(realFilePath);
    const ext = extname(realFilePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch {
    try {
      const indexPath = join(baseDir, 'index.html');
      const indexContent = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexContent);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}
