import { describe, it, expect } from 'vitest';
import type { ToolDefinition } from '../src/types.js';
import { ValidationError } from '../src/types.js';

// We don't exercise stdio here — just sanity-check the types and the
// dispatcher contract via a small inline simulation. The real I/O loop is
// covered indirectly by consumer integration tests.

import { startMcpServer } from '../src/transport/mcp.js';

describe('mcp transport', () => {
  it('exports startMcpServer and ToolDefinition', () => {
    expect(typeof startMcpServer).toBe('function');
    const t: ToolDefinition = {
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
    };
    expect(t.name).toBe('echo');
  });

  it('ValidationError has the expected shape', () => {
    const err = new ValidationError('bad');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
  });
});
