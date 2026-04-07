// =============================================================================
// agent-common — Dashboard auto-start
//
// Starts an HTTP+WebSocket server on a fixed port using leader-election:
// the first process to bind wins; subsequent processes get EADDRINUSE and
// gracefully skip (the existing dashboard is already serving). This lets
// every MCP client process call `startDashboard()` without coordination.
// =============================================================================

import { createServer, type Server } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

export interface DashboardServer {
  httpServer: Server;
  port: number;
  close(): void;
}

export interface DashboardOptions {
  port: number;
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
  return new Promise((resolve, reject) => {
    const httpServer = createServer((req, res) => {
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

    let attached: { close(): void } | void;

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    httpServer.listen(opts.port, () => {
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
