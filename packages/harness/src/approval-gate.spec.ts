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

  it('settles waitFor with the human decision', async () => {
    const hub = {
      sendApprovalRequest: vi.fn(),
      sendMessage: vi.fn(),
      sendProgress: vi.fn(),
      sendNotification: vi.fn(),
    } as unknown as ChannelHubPort;

    const gate = new ApprovalGate({
      channelHub: hub,
      getApprovers: () => [{ channel: '*', userId: 'telegram:1', scope: '*', catchall: true }],
    });

    const requestId = await gate.requestApproval('s1', 'telegram', 'rm -rf', 'Bash');
    const waiter = gate.waitFor(requestId);

    expect(gate.resolve(requestId, 'telegram:1', true)).toBe(true);
    await expect(waiter).resolves.toBe(true);
  });

  it('denies waitFor when the approval times out', async () => {
    vi.useFakeTimers();
    const hub = {
      sendApprovalRequest: vi.fn(),
      sendMessage: vi.fn(),
      sendProgress: vi.fn(),
      sendNotification: vi.fn(),
    } as unknown as ChannelHubPort;

    const gate = new ApprovalGate({
      channelHub: hub,
      getApprovers: () => [],
      approvalTimeoutSeconds: () => 10,
    });

    const requestId = await gate.requestApproval('s1', 'telegram', 'drop table', 'Bash');
    const waiter = gate.waitFor(requestId);

    await vi.advanceTimersByTimeAsync(11_000);
    await expect(waiter).resolves.toBe(false);

    vi.useRealTimers();
  });

  it('reuses a runtime-minted request id so the channel callback matches', async () => {
    const sent: unknown[] = [];
    const hub = {
      sendApprovalRequest: vi.fn(async (_c: unknown, _s: unknown, request: unknown) => {
        sent.push(request);
      }),
      sendMessage: vi.fn(),
      sendProgress: vi.fn(),
      sendNotification: vi.fn(),
    } as unknown as ChannelHubPort;

    const gate = new ApprovalGate({
      channelHub: hub,
      getApprovers: () => [{ channel: '*', userId: 'telegram:1', scope: '*', catchall: true }],
    });

    const requestId = await gate.requestApproval(
      's1',
      'telegram',
      'deploy',
      'tool',
      'req-from-runtime',
    );

    expect(requestId).toBe('req-from-runtime');
    expect(sent[0]).toMatchObject({ requestId: 'req-from-runtime' });
    expect(gate.resolve('req-from-runtime', 'telegram:1', true)).toBe(true);
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
