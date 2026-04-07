// =============================================================================
// agent-common — MCP transport
//
// Generic JSON-RPC over stdio dispatcher. The consumer provides:
//   - serverInfo: { name, version }
//   - tools: ToolDefinition[] | () => ToolDefinition[]   (dynamic supported)
//   - handleTool(name, args): unknown | Promise<unknown> (async supported)
//   - onInitialize(): optional hook fired on MCP initialize
//   - formatResult?: custom JSON → text formatting for tool responses
//   - onToolCalled?: post-response hook with a `notify` callback to emit
//     JSON-RPC notifications like `notifications/tools/list_changed`
//   - capabilities?: custom capabilities object merged over the default
// =============================================================================

import { createInterface } from 'readline';
import { KitError } from '../types.js';
import type { JsonRpcRequest, JsonRpcResponse, ToolDefinition } from '../types.js';

export type ToolList = ToolDefinition[] | (() => ToolDefinition[]);

export type NotifyFn = (method: string, params?: unknown) => void;

export interface McpServerOptions {
  serverInfo: { name: string; version: string };
  tools: ToolList;
  handleTool: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
  onInitialize?: () => void;
  formatResult?: (result: unknown, toolName: string) => string;
  onToolCalled?: (name: string, args: Record<string, unknown>, notify: NotifyFn) => void;
  capabilities?: Record<string, unknown>;
  protocolVersion?: string;
  /** Label used in stderr error prefixes. Default: "agent-common". */
  logLabel?: string;
}

export interface McpServerHandle {
  close(): void;
  notify: NotifyFn;
}

export function startMcpServer(opts: McpServerOptions): McpServerHandle {
  const protocolVersion = opts.protocolVersion ?? '2024-11-05';
  const capabilities = opts.capabilities ?? { tools: {} };
  const label = opts.logLabel ?? 'agent-common';

  function writeResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  const notify: NotifyFn = (method, params) => {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    process.stdout.write(JSON.stringify(payload) + '\n');
  };

  function resolveTools(): ToolDefinition[] {
    return typeof opts.tools === 'function' ? opts.tools() : opts.tools;
  }

  function formatToolText(result: unknown, toolName: string): string {
    return opts.formatResult
      ? opts.formatResult(result, toolName)
      : JSON.stringify(result, null, 2);
  }

  function errorResponse(id: JsonRpcRequest['id'], err: unknown): JsonRpcResponse {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof KitError ? err.code : 'UNKNOWN_ERROR';
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Error [${code}]: ${message}` }],
        isError: true,
      },
    };
  }

  async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        if (opts.onInitialize) {
          try {
            opts.onInitialize();
          } catch (err) {
            process.stderr.write(
              '[' +
                label +
                '] onInitialize error: ' +
                (err instanceof Error ? err.message : String(err)) +
                '\n',
            );
          }
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            serverInfo: opts.serverInfo,
            capabilities,
          },
        };

      case 'notifications/initialized':
        return null;

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: resolveTools() } };

      case 'tools/call': {
        const toolName = String(params?.name ?? '');
        const rawArgs = params?.arguments;
        const toolArgs: Record<string, unknown> =
          typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        try {
          const raw = opts.handleTool(toolName, toolArgs);
          const result = raw instanceof Promise ? await raw : raw;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: formatToolText(result, toolName) }],
            },
          };
        } catch (err) {
          return errorResponse(id, err);
        } finally {
          if (opts.onToolCalled) {
            try {
              opts.onToolCalled(toolName, toolArgs, notify);
            } catch (err) {
              process.stderr.write(
                '[' +
                  label +
                  '] onToolCalled error: ' +
                  (err instanceof Error ? err.message : String(err)) +
                  '\n',
              );
            }
          }
        }
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch (err) {
      process.stderr.write(
        '[' +
          label +
          '] JSON-RPC parse error: ' +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
      writeResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    handleRequest(request)
      .then((response) => {
        if (response) writeResponse(response);
      })
      .catch((err) => {
        process.stderr.write(
          '[' +
            label +
            '] Handler error: ' +
            (err instanceof Error ? err.message : String(err)) +
            '\n',
        );
      });
  });

  return {
    close() {
      rl.close();
    },
    notify,
  };
}
