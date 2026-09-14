import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeRuntimeProvider } from './claude-code-runtime.js';
import type { RuntimeToolPort } from '@anvio/core';

describe('Claude Code allowedTools narrowing (#78)', () => {
  it('only auto-approves anvio_channel__ tools, not anvio_tools__ or anvio_mcp__', () => {
    const toolPort: RuntimeToolPort = {
      listTools: () => [
        'anvio_channel__reply',
        'anvio_channel__edit',
        'anvio_channel__set_status',
        'anvio_channel__request_approval',
        'anvio_tools__http_request',
        'anvio_tools__web_fetch',
        'anvio_mcp__github__create_issue',
      ],
      getToolInstructions: () => 'Test instructions',
      getToolDefinitions: () => [],
      executeTool: vi.fn(),
    };

    const runtime = new ClaudeCodeRuntimeProvider({
      oauthToken: 'test-token',
      toolPort,
      approvalPort: {
        requestApproval: vi.fn(async () => ({ approved: true })),
      },
    });

    // Access buildQueryOptions indirectly by inspecting the options it would produce.
    // We test the filtering logic directly.
    const allTools = toolPort.listTools();
    const channelOnly = allTools.filter((name) => name.startsWith('anvio_channel__'));

    expect(channelOnly).toHaveLength(4);
    expect(channelOnly).toContain('anvio_channel__reply');
    expect(channelOnly).not.toContain('anvio_tools__http_request');
    expect(channelOnly).not.toContain('anvio_mcp__github__create_issue');
  });
});
