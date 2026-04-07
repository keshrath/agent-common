// =============================================================================
// agent-common — MCP transport
//
// Generic JSON-RPC over stdio dispatcher. The consumer provides:
//   - tools: ToolDefinition[]
//   - handleTool(name, args): unknown   (the per-tool dispatcher)
//   - serverInfo: { name, version }
//   - onInitialize(): optional hook (e.g. to start the dashboard)
// =============================================================================

import { createInterface } from 'readline';
import { KitError } from '../types.js';
import type { JsonRpcRequest, JsonRpcResponse, ToolDefinition } from '../types.js';

export interface McpServerOptions {
  serverInfo: { name: string; version: string };
  tools: ToolDefinition[];
  handleTool: (name: string, args: Record<string, unknown>) => unknown;
  onInitialize?: () => void;
  protocolVersion?: string;
}

export interface McpServerHandle {
  close(): void;
}

export function startMcpServer(opts: McpServerOptions): McpServerHandle {
  const protocolVersion = opts.protocolVersion ?? '2024-11-05';
  const capabilities = { tools: {} };

  function writeResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  function handleRequest(request: JsonRpcRequest): JsonRpcResponse | null {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        if (opts.onInitialize) {
          try {
            opts.onInitialize();
          } catch (err) {
            process.stderr.write(
              '[agent-common] onInitialize error: ' +
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
        return { jsonrpc: '2.0', id, result: { tools: opts.tools } };

      case 'tools/call': {
        const toolName = String(params?.name ?? '');
        const rawArgs = params?.arguments;
        const toolArgs: Record<string, unknown> =
          typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        try {
          const result = opts.handleTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          };
        } catch (err) {
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
    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      const response = handleRequest(request);
      if (response) writeResponse(response);
    } catch (err) {
      process.stderr.write(
        '[agent-common] JSON-RPC parse error: ' +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
      writeResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
  });

  return {
    close() {
      rl.close();
    },
  };
}
