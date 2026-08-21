import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemStorageProvider } from '@anvio/storage';
import { createTokenUsageAudit, estimateTokenCostUsd } from './token-usage-audit.js';

describe('TokenUsageAudit', () => {
  it('appends usage records to audit/tokens.jsonl', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-tokens-'));
    const storage = new FilesystemStorageProvider(tmpDir);
    const audit = createTokenUsageAudit(storage);

    await audit.record({
      sessionId: 'sess-1',
      channel: 'cli',
      agentId: 'architect',
      userId: 'u1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    });

    const raw = await fs.readFile(path.join(tmpDir, 'audit/tokens.jsonl'), 'utf-8');
    const line = JSON.parse(raw.trim()) as {
      sessionId: string;
      usage: { totalTokens: number };
      estimatedCostUsd?: number;
    };
    expect(line.sessionId).toBe('sess-1');
    expect(line.usage.totalTokens).toBe(1500);
    expect(line.estimatedCostUsd).toBeGreaterThan(0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('estimates cost for known models', () => {
    const cost = estimateTokenCostUsd('gemini', 'gemini-2.0-flash', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.1, 5);
  });

  it('costs a model the old three-entry table did not know', () => {
    // deepseek-chat was absent from MODEL_COST_PER_1M, so the cost column was
    // silently blank for it. It resolves through the descriptor registry now.
    const cost = estimateTokenCostUsd('deepseek', 'deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.27, 5);
  });

  it('does not bill cached tokens twice', () => {
    // inputTokens is the inclusive total: 1M prompt of which 900k was a cache hit.
    // Full rate applies to 100k, cache-read rate (10% of input) to the rest.
    const cost = estimateTokenCostUsd('anthropic', 'claude-sonnet-4-20250514', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      cacheReadInputTokens: 900_000,
    });
    expect(cost).toBeCloseTo(0.1 * 3 + 0.9 * 0.3, 5);
  });

  it('returns undefined without a provider', () => {
    expect(
      estimateTokenCostUsd(undefined, 'gpt-4o', {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
    ).toBeUndefined();
  });
});
