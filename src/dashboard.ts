// =============================================================================
// agent-common — Dashboard auto-start
//
// Starts an HTTP+WebSocket server on a fixed port using leader-election:
// the first process to bind wins; subsequent processes get EADDRINUSE and
// gracefully skip (the existing dashboard is already serving). This lets
// every MCP client process call `startDashboard()` without coordination.
//
// Binds 127.0.0.1 by default and runs every request (and WebSocket upgrade)
// through the shared request guard. Consumers expose an opt-in override via
// an `AGENT_<NAME>_HOST` env var passed as `host`.
// =============================================================================

import { createServer, type Server } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { attachRequestGuard, createRequestGuard } from './transport/guard.js';

export interface DashboardServer {
  httpServer: Server;
  port: number;
  close(): void;
}

export interface DashboardOptions {
  port: number;
  /** Listen address (default `127.0.0.1`). `0.0.0.0` exposes the dashboard to the network. */
  host?: string;
  /** Extra exact Origin values accepted besides loopback, same-origin and `file://`. */
  allowedOrigins?: string[];
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  /** Optional callback after the HTTP server is listening, to attach a WebSocket. */
  onListen?: (httpServer: Server) => { close(): void } | void;
  /** Banner string written to stderr on successful start. Defaults to dashboard URL. */
  banner?: (port: number) => string;
}

/**
 * Start a dashboard HTTP server. Resolves to a `DashboardServer` on success.
 * Rejects with an error whose `code === 'EADDRINUSE'` when the port is taken.
 */
export function startDashboard(opts: DashboardOptions): Promise<DashboardServer> {
  const host = opts.host || '127.0.0.1';
  const guard = createRequestGuard({ bindHost: host, allowedOrigins: opts.allowedOrigins });
  return new Promise((resolve, reject) => {
    const httpServer = createServer((req, res) => {
      if (guard.handle(req, res)) return;
      Promise.resolve(opts.handler(req, res)).catch((err) => {
        process.stderr.write(
          '[agent-common] Dashboard handler error: ' +
            (err instanceof Error ? err.message : String(err)) +
            '\n',
        );
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal server error');
        }
      });
    });

    attachRequestGuard(httpServer, guard);
    let attached: { close(): void } | void;

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    httpServer.listen(opts.port, host, () => {
      try {
        attached = opts.onListen?.(httpServer);
      } catch (err) {
        process.stderr.write(
          '[agent-common] Dashboard onListen error: ' +
            (err instanceof Error ? err.message : String(err)) +
            '\n',
        );
      }
      const banner = opts.banner
        ? opts.banner(opts.port)
        : `dashboard: http://localhost:${opts.port}`;
      process.stderr.write(banner + '\n');
      resolve({
        httpServer,
        port: opts.port,
        close() {
          if (attached) attached.close();
          httpServer.close();
        },
      });
    });
  });
}

/**
 * Try to start a dashboard, but resolve to `null` (rather than rejecting) if the
 * port is already taken. Use this from MCP entrypoints where multiple processes
 * may race to bind the same port.
 */
export async function tryStartDashboard(opts: DashboardOptions): Promise<DashboardServer | null> {
  try {
    return await startDashboard(opts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      process.stderr.write(
        `[agent-common] Dashboard port ${opts.port} in use — another instance is serving.\n`,
      );
      return null;
    }
    throw err;
  }
}
