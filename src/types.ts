// =============================================================================
// agent-common — Shared types and error classes
// =============================================================================

export class KitError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'KIT_ERROR',
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'KitError';
  }
}

export class ValidationError extends KitError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends KitError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier ? `${resource} not found: ${identifier}` : `${resource} not found`,
      'NOT_FOUND',
      404,
    );
    this.name = 'NotFoundError';
  }
}

// ---------------------------------------------------------------------------
// MCP types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null | undefined;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
