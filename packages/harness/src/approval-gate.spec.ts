import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from './approval-gate.js';
import type { ChannelHubPort } from '@anvio/core';

describe('ApprovalGate', () => {
  it('auto-denies after timeout when configured', async () => {
    vi.useFakeTimers();
    const hub = {
      sendApprovalRequest: vi.fn(),
      sendMessage: vi.fn(),
      sendProgress: vi.fn(),
      sendNotification: vi.fn(),
    } as unknown as ChannelHubPort;

    const timedOut: Array<{ sessionId: string; requestId: string }> = [];
    const gate = new ApprovalGate({
      channelHub: hub,
      getApprovers: () => [],
      approvalTimeoutSeconds: () => 30,
      onTimedOut: (sessionId, requestId) => {
        timedOut.push({ sessionId, requestId });
      },
    });

    const requestId = await gate.requestApproval('s1', 'telegram', 'deploy prod', 'test_tool');
    expect(requestId).toBeTruthy();

    await vi.advanceTimersByTimeAsync(31_000);
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]?.requestId).toBe(requestId);
    expect(gate.getContext(requestId)).toBeUndefined();

    vi.useRealTimers();
  });

  it('resolves only for authorized approver scope', async () => {
    const hub = {
      sendApprovalRequest: vi.fn(),
      sendMessage: vi.fn(),
      sendProgress: vi.fn(),
      sendNotification: vi.fn(),
    } as unknown as ChannelHubPort;

    const gate = new ApprovalGate({
      channelHub: hub,
      getApprovers: () => [
        { channel: '*', userId: 'telegram:99', scope: 'deploy production', catchall: false },
      ],
    });

    const requestId = await gate.requestApproval(
      's1',
      'telegram',
      'deploy production schema',
      'tool',
    );

    expect(gate.resolve(requestId, 'telegram:88', true)).toBe(false);
    expect(gate.resolve(requestId, 'telegram:99', true)).toBe(true);
  });
});
