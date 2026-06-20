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
    const cost = estimateTokenCostUsd('gemini-2.0-flash', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.1, 5);
  });
});
