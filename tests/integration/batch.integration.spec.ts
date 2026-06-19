import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createBatchEngine } from '@anvio/batch';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';

describe('Batch Processing', () => {
  let tmpDir: string;
  let storage: FilesystemStorageProvider;
  const attemptCounts = new Map<string, number>();

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-batch-'));
    await Workspace.init(tmpDir);
    storage = new FilesystemStorageProvider(tmpDir);
    attemptCounts.clear();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createEngine() {
    return createBatchEngine({
      storage,
      workspaceRoot: tmpDir,
      blueprintRunner: {
        async run(_blueprint, inputs) {
          const key = String(inputs.line ?? inputs.id ?? 'unknown');
          const count = (attemptCounts.get(key) ?? 0) + 1;
          attemptCounts.set(key, count);

          if (key === 'fail-once' && count === 1) {
            throw new Error('timeout exceeded');
          }

          return { status: 'completed', output: { processed: key } };
        },
      },
    });
  }

  it('completes 10 items with concurrency 3', async () => {
    const engine = createEngine();
    const items = Array.from({ length: 10 }, (_, i) => ({ line: `repo-${i + 1}` }));

    const result = await engine.run({
      name: 'Review repos',
      blueprint: 'repository-analysis',
      input: { type: 'inline', items },
      concurrency: 3,
      retry: { maxAttempts: 1, backoff: 'fixed', delayMs: 10, retryOn: [] },
    });

    expect(result.progress.completed).toBe(10);
    expect(result.progress.failed).toBe(0);
    expect(result.status).toBe('completed');
  });

  it('retry recovers transient failure', async () => {
    const engine = createEngine();
    const result = await engine.run({
      name: 'Retry test',
      blueprint: 'repository-analysis',
      input: { type: 'inline', items: [{ line: 'fail-once' }] },
      concurrency: 1,
      retry: {
        maxAttempts: 3,
        backoff: 'fixed',
        delayMs: 10,
        retryOn: ['timeout'],
      },
    });

    expect(result.progress.completed).toBe(1);
    expect(result.progress.failed).toBe(0);
  });

  it('resume retries only failed items', async () => {
    const engine = createBatchEngine({
      storage,
      workspaceRoot: tmpDir,
      blueprintRunner: {
        async run(_blueprint, inputs) {
          const key = String(inputs.line);
          if (key === 'bad') throw new Error('permanent error');
          return { status: 'completed', output: key };
        },
      },
    });

    const first = await engine.run({
      name: 'Partial batch',
      blueprint: 'test',
      input: {
        type: 'inline',
        items: [{ line: 'good' }, { line: 'bad' }],
      },
      concurrency: 2,
      retry: { maxAttempts: 1, backoff: 'fixed', delayMs: 10, retryOn: [] },
    });

    expect(first.progress.completed).toBe(1);
    expect(first.progress.failed).toBe(1);
    expect(first.status).toBe('partial');

    const resumed = await engine.resume(first.jobId, true);
    expect(resumed.progress.completed).toBe(1);
    expect(resumed.progress.failed).toBe(1);
  });

  it('tracks progress via getStatus', async () => {
    const engine = createEngine();
    const result = await engine.run({
      name: 'Status test',
      blueprint: 'daily-summary',
      input: { type: 'inline', items: [{ line: 'a' }, { line: 'b' }] },
      concurrency: 2,
      retry: { maxAttempts: 1, backoff: 'fixed', delayMs: 10, retryOn: [] },
    });

    const status = await engine.getStatus(result.jobId);
    expect(status?.status).toBe('completed');
    expect(status?.stats.completed).toBe(2);
  });
});
