import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage, StoredSession } from '@anvio/core';
import type { ChannelSessionBridge } from './channel-session-bridge.js';
import { SimulatedChannel } from './simulated-channel.js';

function channel(onApproval = vi.fn(async () => ({ status: 'resolved' as const }))) {
  const bridge = {
    resolveOrCreate: vi.fn(async (_c: string, threadId: string) => ({ id: `s-${threadId}` }) as StoredSession),
  } as unknown as ChannelSessionBridge;
  return new SimulatedChannel({ channelType: 'slack', sessionBridge: bridge, defaultAgent: 'a', onApproval });
}

describe('SimulatedChannel', () => {
  it('dispatches inbound with thread and mention facts', async () => {
    const sim = channel();
    const seen: InboundMessage[] = [];
    sim.onMessage(async (m) => void seen.push(m));
    expect(await sim.say({ userId: 'U1', threadId: 't1', text: 'hi', mentionedBot: true })).toBe('s-t1');
    expect(seen[0]).toMatchObject({
      channel: 'slack',
      channelThreadId: 't1',
      metadata: { mentionedBot: true, mentionedOther: false, isDm: false },
    });
  });

  it('buffers streamed chunks into one message and wakes waiters', async () => {
    const sim = channel();
    const waiting = sim.waitFor((e) => e.kind === 'message');
    await sim.sendMessage('s1', { sessionId: 's1', type: 'chunk', delta: 'hel' });
    await sim.sendMessage('s1', { sessionId: 's1', type: 'chunk', delta: 'lo' });
    await sim.sendMessage('s1', { sessionId: 's1', type: 'done' });
    expect(await waiting).toEqual({ kind: 'message', sessionId: 's1', text: 'hello', metadata: undefined });
  });

  it('records approval prompts and forwards decisions', async () => {
    const onApproval = vi.fn(async () => ({ status: 'resolved' as const }));
    const sim = channel(onApproval);
    await sim.sendApprovalRequest('s1', { sessionId: 's1', requestId: 'r1', toolName: 'deploy', reason: 'prod', actions: ['approve', 'reject'] });
    expect(sim.outbox[0]).toMatchObject({ kind: 'approval', requestId: 'r1', toolName: 'deploy' });
    await sim.decideApproval('s1', 'r1', true, 'U1');
    expect(onApproval).toHaveBeenCalledWith('s1', 'r1', true, 'U1');
  });

  it('times out when nothing matches', async () => {
    await expect(channel().waitFor(() => true, 10)).rejects.toThrow('timed out');
  });
});
