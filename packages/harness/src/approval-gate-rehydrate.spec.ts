import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from './approval-gate.js';
import type { ChannelHubPort } from '@anvio/core';

function makeGate(options: { approvers?: unknown[]; onTimedOut?: (s: string, r: string) => void } = {}) {
  const hub = {
    sendApprovalRequest: vi.fn(),
    sendMessage: vi.fn(),
    sendProgress: vi.fn(),
    sendNotification: vi.fn(),
  } as unknown as ChannelHubPort;

  return new ApprovalGate({
    channelHub: hub,
    getApprovers: () =>
      (options.approvers ?? [{ channel: '*', userId: 'telegram:1', scope: '*', catchall: true }]) as never,
    approvalTimeoutSeconds: () => 300,
    onTimedOut: options.onTimedOut,
  });
}

describe('ApprovalGate.rehydrate', () => {
  it('restores a live pending approval from persisted state', () => {
    const gate = makeGate();
    const future = new Date(Date.now() + 60_000).toISOString();

    gate.rehydrate([
      { requestId: 'r1', sessionId: 's1', channel: 'telegram', summary: 'deploy', expiresAt: future },
    ]);

    expect(gate.getContext('r1')).toBeDefined();
    expect(gate.resolve('r1', 'telegram:1', true)).toEqual({ status: 'resolved' });
  });

  it('immediately expires a past-due approval', () => {
    const timedOut: string[] = [];
    const gate = makeGate({ onTimedOut: (_s, r) => timedOut.push(r) });
    const past = new Date(Date.now() - 1000).toISOString();

    gate.rehydrate([
      { requestId: 'r2', sessionId: 's1', channel: 'telegram', summary: 'old', expiresAt: past },
    ]);

    expect(gate.getContext('r2')).toBeUndefined();
    expect(timedOut).toContain('r2');
  });

  it('returns not_found for an unknown request id', () => {
    const gate = makeGate();
    expect(gate.resolve('nonexistent', 'telegram:1', true)).toEqual({ status: 'not_found' });
  });

  it('returns not_authorized when user is not an approver', async () => {
    const gate = makeGate();
    const id = await gate.requestApproval('s1', 'telegram', 'test', 'tool');
    expect(gate.resolve(id, 'telegram:999', true)).toEqual({ status: 'not_authorized' });
  });

  it('returns already_resolved on second resolve attempt', async () => {
    const gate = makeGate();
    const id = await gate.requestApproval('s1', 'telegram', 'test', 'tool');
    gate.resolve(id, 'telegram:1', true);
    expect(gate.resolve(id, 'telegram:1', true)).toEqual({ status: 'not_found' });
  });
});
