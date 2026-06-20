import { describe, expect, it } from 'vitest';
import {
  createMcpFirstCallGate,
  formatMcpToolName,
  mcpApprovalKey,
  parseMcpToolName,
} from './mcp-first-call-gate.js';

describe('mcp-first-call-gate', () => {
  it('formats and parses MCP tool names', () => {
    const full = formatMcpToolName('github', 'search_code');
    expect(full).toBe('anvio_mcp__github__search_code');
    expect(parseMcpToolName(full)).toEqual({ serverId: 'github', toolName: 'search_code' });
  });

  it('requires approval until explicitly approved', async () => {
    const gate = createMcpFirstCallGate({ enabled: true });
    expect(await gate.isApproved('s1', 'github', 'search_code')).toBe(false);
    await gate.approve('s1', 'github', 'search_code');
    expect(await gate.isApproved('s1', 'github', 'search_code')).toBe(true);
    expect(mcpApprovalKey('github', 'search_code')).toBe('github/search_code');
  });

  it('persists approved keys via callbacks', async () => {
    const store = new Map<string, string[]>();
    const gate = createMcpFirstCallGate({
      getApproved: (sessionId) => store.get(sessionId) ?? [],
      persistApproved: (sessionId, keys) => {
        store.set(sessionId, keys);
      },
    });

    await gate.approveToolName('sess-a', 'anvio_mcp__github__create_issue');
    expect(store.get('sess-a')).toContain('github/create_issue');
  });
});
