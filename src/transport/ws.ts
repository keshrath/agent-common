// =============================================================================
// agent-common — WebSocket transport
//
// Generic delta-streaming WebSocket server. The consumer provides:
//   - getFingerprints(): an object whose keys are categories and values are
//     short fingerprint strings derived from the DB. Polled every interval.
//   - getCategoryData(category): returns the current data for a category.
//     The returned object is SPREAD into the delta payload, so the consumer
//     controls the keys — this lets one category push multiple related
//     fields (e.g. messages + messageCount) in a single delta.
//   - getFullState(): returns the full state payload sent on connect and
//     on client `refresh`.
//
// Optional:
//   - onMessage(ws, msg): handle custom client-to-server message types
//     beyond the built-in `refresh`. Return true if handled.
// =============================================================================

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

export interface WsHandle {
  wss: WebSocketServer;
  /** Send a raw JSON string to every open client. */
  broadcast(message: string): void;
  close(): void;
}

export interface WsOptions<F extends Record<string, string>> {
  /** HTTP server to attach to. */
  httpServer: Server;
  /** Compute current fingerprints. Cheap query — runs every poll interval. */
  getFingerprints: () => F;
  /**
   * Fetch fresh data for a single changed category. Return an object that
   * will be SPREAD into the delta payload (so the consumer controls keys).
   * For the simple case, return `{ [category]: value }`. For bundled fields,
   * return `{ messages: [...], messageCount: n }`.
   */
  getCategoryData: (category: keyof F) => Record<string, unknown>;
  /** Fetch full state payload (sent on connect and on client `refresh`). */
  getFullState: () => Record<string, unknown>;
  /**
   * Optional custom message handler. Called after `refresh` has been ruled out.
   * Return true to signal the message was handled; false/undefined falls through
   * to the default "unknown message type" error response.
   */
  onMessage?: (ws: WebSocket, msg: { type?: string; [key: string]: unknown }) => boolean | void;
  /** Max concurrent connections (default: 50). */
  maxConnections?: number;
  /** Max single message size in bytes (default: 4096). */
  maxMessageSize?: number;
  /** Ping interval in ms (default: 30s). */
  pingIntervalMs?: number;
  /** DB poll interval in ms (default: 2s). */
  pollIntervalMs?: number;
  /** Logger for errors. */
  logError?: (err: unknown) => void;
}

interface ClientState<F> {
  alive: boolean;
  fingerprints: F | null;
}

export function setupWebSocket<F extends Record<string, string>>(opts: WsOptions<F>): WsHandle {
  const maxConnections = opts.maxConnections ?? 50;
  const maxMessageSize = opts.maxMessageSize ?? 4096;
  const pingIntervalMs = opts.pingIntervalMs ?? 30_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
  const logError =
    opts.logError ??
    ((err) => {
      process.stderr.write(
        '[agent-common] WS error: ' + (err instanceof Error ? err.message : String(err)) + '\n',
      );
    });

  const wss = new WebSocketServer({ server: opts.httpServer, maxPayload: maxMessageSize });
  wss.on('error', (err) => {
    logError(err);
  });
  const clients = new Map<WebSocket, ClientState<F>>();

  function sendFull(ws: WebSocket): void {
    try {
      const fp = opts.getFingerprints();
      const state = clients.get(ws);
      if (state) state.fingerprints = { ...fp };
      ws.send(JSON.stringify({ type: 'state', ...opts.getFullState() }));
    } catch (err) {
      logError(err);
    }
  }

  function sendDelta(ws: WebSocket, state: ClientState<F>, currentFp: F): void {
    const prev = state.fingerprints!;
    const changed: Record<string, unknown> = {};
    let hasChanges = false;

    for (const key of Object.keys(currentFp) as Array<keyof F>) {
      if (prev[key] !== currentFp[key]) {
        const data = opts.getCategoryData(key);
        Object.assign(changed, data);
        hasChanges = true;
      }
    }

    if (!hasChanges) return;
    state.fingerprints = { ...currentFp };

    try {
      ws.send(JSON.stringify({ type: 'state', delta: true, ...changed }));
    } catch (err) {
      logError(err);
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    if (wss.clients.size > maxConnections) {
      ws.close(1013, 'Too many connections');
      return;
    }

    clients.set(ws, { alive: true, fingerprints: null });
    sendFull(ws);

    ws.on('pong', () => {
      const state = clients.get(ws);
      if (state) state.alive = true;
    });

    ws.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message must be a JSON object' }));
        return;
      }

      const msg = parsed as { type?: string; [key: string]: unknown };
      if (msg.type === 'refresh') {
        const state = clients.get(ws);
        if (state) state.fingerprints = null;
        sendFull(ws);
        return;
      }

      if (opts.onMessage) {
        const handled = opts.onMessage(ws, msg);
        if (handled) return;
      }

      const safeType = String(msg.type ?? '')
        .slice(0, 64)
        .replace(/[<>&"']/g, '');
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${safeType}` }));
    });

    ws.on('error', () => clients.delete(ws));
    ws.on('close', () => clients.delete(ws));
  });

  const pingTimer = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      state.alive = false;
      ws.ping();
    }
  }, pingIntervalMs);
  pingTimer.unref();

  const pollTimer = setInterval(() => {
    if (clients.size === 0) return;
    try {
      const currentFp = opts.getFingerprints();
      for (const [ws, state] of clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (!state.fingerprints) {
          sendFull(ws);
          continue;
        }
        sendDelta(ws, state, currentFp);
      }
    } catch (err) {
      logError(err);
    }
  }, pollIntervalMs);
  pollTimer.unref();

  return {
    wss,
    broadcast(message: string): void {
      for (const [ws] of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    },
    close() {
      clearInterval(pingTimer);
      clearInterval(pollTimer);
      for (const [ws] of clients) {
        ws.close(1001, 'Server shutting down');
      }
      clients.clear();
      wss.close();
    },
  };
}
