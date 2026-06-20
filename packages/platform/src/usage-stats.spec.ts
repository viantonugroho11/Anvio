import { describe, expect, it } from 'vitest';
import { aggregateTokenUsage } from './usage-stats.js';

describe('aggregateTokenUsage', () => {
  it('sums tokens and groups by agent and channel', () => {
    const stats = aggregateTokenUsage([
      {
        ts: new Date().toISOString(),
        sessionId: 's1',
        channel: 'cli',
        agentId: 'architect',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        estimatedCostUsd: 0.001,
      },
      {
        ts: new Date().toISOString(),
        sessionId: 's2',
        channel: 'slack',
        agentId: 'architect',
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
        estimatedCostUsd: 0.002,
      },
    ]);

    expect(stats.runs).toBe(2);
    expect(stats.totalTokens).toBe(450);
    expect(stats.byAgent.architect?.totalTokens).toBe(450);
    expect(stats.byChannel.cli?.totalTokens).toBe(150);
  });
});
