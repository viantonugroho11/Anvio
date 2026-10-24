import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRequest, ModelProvider, StreamChunk } from '@anvio/core';
import { SimulatedChannel } from '@anvio/channels';
import { createPlatform, prepareSimulationWorkspace, registerGatewayWorker } from '@anvio/platform';

const repoRoot = path.resolve(__dirname, '../..');

/** Slow provider that records how many streams overlap. */
function slowProvider() {
  let active = 0;
  let calls = 0;
  const stats = { peak: 0, seen: [] as string[] };
  const provider: ModelProvider = {
    providerId: 'scripted',
    supportsNativeTools: false,
    chat: async () => {
      throw new Error('not used');
    },
    async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
      active++;
      stats.peak = Math.max(stats.peak, active);
      const n = ++calls;
      stats.seen.push(
        request.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
          .join('|'),
      );
      try {
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield { type: 'text_delta', delta: `reply-${n}` };
        yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      } finally {
        active--;
      }
    },
  };
  return { provider, stats };
}

describe('gateway worker serializes turns per session (CQ-007)', () => {
  const workspaces: string[] = [];
  afterEach(async () => {
    // Session-end work (learning loop, token audit) can still be writing when the
    // test finishes; retry the removal instead of failing on ENOTEMPTY.
    await Promise.all(
      workspaces
        .splice(0)
        .map((w) => fs.rm(w, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
    );
  });

  it('runs two messages in one thread one after the other and keeps both turns', async () => {
    const workspacePath = await prepareSimulationWorkspace(path.join(repoRoot, 'workspace'));
    workspaces.push(workspacePath);
    const { provider, stats } = slowProvider();
    let channel: SimulatedChannel | undefined;
    const platform = await createPlatform({
      workspacePath,
      repoRoot,
      simulation: {
        modelProvider: provider,
        adapters: ({ sessionBridge, onApproval }) => {
          channel = new SimulatedChannel({ channelType: 'webchat', sessionBridge, onApproval });
          return [channel];
        },
      },
    });
    try {
      await registerGatewayWorker(platform);
      const sim = channel!;
      const [first, second] = await Promise.all([
        sim.say({
          userId: 'webchat:u1',
          threadId: 't1',
          text: 'first question',
          isDm: true,
          mentionedBot: true,
        }),
        sim.say({
          userId: 'webchat:u1',
          threadId: 't1',
          text: 'second question',
          isDm: true,
          mentionedBot: true,
        }),
      ]);
      // The second turn may still be queued when say() returns; wait for it.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const stored = await platform.workspace.sessions.get(first);
        if ((stored?.messages.length ?? 0) >= 4) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(second).toBe(first);
      expect(stats.peak).toBe(1);
      const stored = await platform.workspace.sessions.get(first);
      const contents = stored?.messages.map((m) => m.content) ?? [];
      // Both turns are kept, each reply right after its own question.
      expect(contents).toHaveLength(4);
      expect([contents[0], contents[2]].sort()).toEqual(['first question', 'second question']);
      expect([contents[1], contents[3]]).toEqual(['reply-1', 'reply-2']);
      // The later turn ran with the earlier turn already in its history.
      expect(stats.seen[1]).toContain(contents[0]);
    } finally {
      await platform.shutdown();
    }
  }, 30_000);
});
