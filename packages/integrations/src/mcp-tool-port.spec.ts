import { describe, expect, it, vi } from 'vitest';
import type { RuntimeToolPort, RuntimeToolContext } from '@anvio/core';
import { McpToolPort } from './mcp-tool-port.js';
import { createMcpFirstCallGate } from './mcp-first-call-gate.js';
import type { McpBridge } from './mcp-bridge.js';

function makeInnerPort(): RuntimeToolPort {
  return {
    listTools: () => ['builtin:noop'],
    getToolInstructions: () => 'builtin instructions',
    getModelToolDefinitions: () => [],
    call: vi.fn(async (call) => ({
      name: call.name,
      output: 'inner ran',
      status: 'completed' as const,
    })),
  };
}

function makeBridge(): McpBridge {
  return {
    listTools: async () => [],
    callTool: vi.fn(async ({ toolName }) => ({
      status: 'completed' as const,
      output: `bridge ran ${toolName}`,
    })),
  } as unknown as McpBridge;
}

const ctx: RuntimeToolContext = {
  sessionId: 's1',
  agentId: 'a1',
  userId: 'u1',
};

describe('McpToolPort × McpFirstCallGate', () => {
  it('delegates non-MCP tool calls to inner port', async () => {
    const inner = makeInnerPort();
    const gate = createMcpFirstCallGate({ enabled: true });
    const port = new McpToolPort(inner, { mcpBridge: makeBridge(), gate });

    const res = await port.call({ name: 'builtin:noop', arguments: {} }, ctx);
    expect(res.status).toBe('completed');
    expect(res.output).toBe('inner ran');
  });

  it('returns pending_approval on first MCP call when gate enabled', async () => {
    const gate = createMcpFirstCallGate({ enabled: true });
    const port = new McpToolPort(makeInnerPort(), { mcpBridge: makeBridge(), gate });

    const res = await port.call(
      { name: 'anvio_mcp__github__search_code', arguments: { q: 'x' } },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
    expect(res.approvalRequestId).toBeTruthy();
    const output = res.output as { serverId: string; toolName: string };
    expect(output.serverId).toBe('github');
    expect(output.toolName).toBe('search_code');
  });

  it('passes through after approval', async () => {
    const bridge = makeBridge();
    const gate = createMcpFirstCallGate({ enabled: true });
    const port = new McpToolPort(makeInnerPort(), { mcpBridge: bridge, gate });

    await gate.approve('s1', 'github', 'search_code');
    const res = await port.call(
      { name: 'anvio_mcp__github__search_code', arguments: { q: 'x' } },
      ctx,
    );
    expect(res.status).toBe('completed');
    expect(res.output).toBe('bridge ran search_code');
    expect(bridge.callTool).toHaveBeenCalledOnce();
  });

  it('bypasses gate entirely when disabled', async () => {
    const gate = createMcpFirstCallGate({ enabled: false });
    const bridge = makeBridge();
    const port = new McpToolPort(makeInnerPort(), { mcpBridge: bridge, gate });

    const res = await port.call(
      { name: 'anvio_mcp__github__search_code', arguments: {} },
      ctx,
    );
    expect(res.status).toBe('completed');
    expect(bridge.callTool).toHaveBeenCalledOnce();
  });

  it('per-session isolation — approving in s1 does not approve s2', async () => {
    const gate = createMcpFirstCallGate({ enabled: true });
    const port = new McpToolPort(makeInnerPort(), { mcpBridge: makeBridge(), gate });

    await gate.approve('s1', 'github', 'search_code');
    const res = await port.call(
      { name: 'anvio_mcp__github__search_code', arguments: {} },
      { ...ctx, sessionId: 's2' },
    );
    expect(res.status).toBe('pending_approval');
  });

  it('per-tool isolation — approving search_code does not approve create_issue', async () => {
    const gate = createMcpFirstCallGate({ enabled: true });
    const port = new McpToolPort(makeInnerPort(), { mcpBridge: makeBridge(), gate });

    await gate.approve('s1', 'github', 'search_code');
    const res = await port.call(
      { name: 'anvio_mcp__github__create_issue', arguments: {} },
      ctx,
    );
    expect(res.status).toBe('pending_approval');
  });

  it('fails cleanly on malformed MCP tool name', async () => {
    const gate = createMcpFirstCallGate({ enabled: true });
    const port = new McpToolPort(makeInnerPort(), { mcpBridge: makeBridge(), gate });

    const res = await port.call({ name: 'anvio_mcp__bad', arguments: {} }, ctx);
    expect(res.status).toBe('failed');
    expect(res.error).toBe('Invalid MCP tool name');
  });

  it('appends MCP tools to listTools and getModelToolDefinitions', () => {
    const port = new McpToolPort(makeInnerPort(), {
      mcpBridge: makeBridge(),
      gate: createMcpFirstCallGate(),
      mcpToolNames: ['anvio_mcp__github__search_code'],
      mcpToolDefinitions: [
        {
          name: 'anvio_mcp__github__search_code',
          description: 'Search',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    expect(port.listTools()).toContain('anvio_mcp__github__search_code');
    expect(port.getModelToolDefinitions()).toHaveLength(1);
  });

  it('adds MCP first-use note to tool instructions when tools present', () => {
    const port = new McpToolPort(makeInnerPort(), {
      mcpBridge: makeBridge(),
      gate: createMcpFirstCallGate(),
      mcpToolNames: ['anvio_mcp__github__search_code'],
      mcpToolDefinitions: [
        {
          name: 'anvio_mcp__github__search_code',
          description: 'Search',
          inputSchema: {},
        },
      ],
    });
    const instr = port.getToolInstructions();
    expect(instr).toContain('MCP tools');
    expect(instr).toContain('First use');
    expect(instr).toContain('anvio_mcp__github__search_code');
  });
});
