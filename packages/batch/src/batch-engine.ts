import type {
  BatchEngine,
  BatchJobSpec,
  BatchRunOptions,
  BatchRunResult,
  BlueprintRunner,
} from '@anvio/core';
import type { BatchItemRecord, BatchJob, BatchJobStatus } from '@anvio/core';
import { batchJobSchema } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { randomUUID } from 'node:crypto';
import { computeProgress, FilesystemProgressStore } from './filesystem-progress-store.js';
import {
  backoffDelay,
  buildItemsFromLines,
  isRetryableError,
  runWithConcurrency,
  type WorkItem,
} from './work-scheduler.js';

export interface BatchEngineDeps {
  storage: FilesystemStorageProvider;
  workspaceRoot: string;
  blueprintRunner: BlueprintRunner;
}

export class BatchEngineImpl implements BatchEngine {
  private readonly progress: FilesystemProgressStore;
  private readonly cancelled = new Set<string>();

  constructor(private readonly deps: BatchEngineDeps) {
    this.progress = new FilesystemProgressStore(deps.storage, deps.workspaceRoot);
  }

  async run(spec: BatchJobSpec, jobId?: string, options: BatchRunOptions = {}): Promise<BatchRunResult> {
    const id = jobId ?? `batch-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6)}`;
    const job: BatchJob = batchJobSchema.parse({
      apiVersion: 'anvio.io/v1',
      kind: 'BatchJob',
      metadata: { id, createdAt: new Date().toISOString() },
      spec: { ...spec, dryRun: options.dryRun ?? spec.dryRun },
    });

    await this.progress.saveJob(job);
    await this.progress.saveStatus(id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      stats: { total: 0, completed: 0, failed: 0, skipped: 0, inProgress: 0 },
    });

    const workItems = await this.resolveItems(job.spec);
    let items: BatchItemRecord[] = workItems.map((item) => ({
      id: item.id,
      status: 'pending',
      attempts: 0,
      inputs: item.inputs,
    }));

    if (options.resume || options.retryFailed) {
      const existing = await this.progress.listItems(id);
      if (existing.length > 0) {
        items = existing.map((item) => {
          if (options.retryFailed && item.status === 'failed') {
            return { ...item, status: 'pending' as const, error: undefined };
          }
          if (options.resume && (item.status === 'pending' || item.status === 'running')) {
            return { ...item, status: 'pending' as const };
          }
          return item;
        });
      }
    }

    for (const item of items) {
      await this.progress.saveItem(id, item);
    }

    await this.executeItems(job, items);
    return this.buildResult(id);
  }

  async getStatus(jobId: string) {
    return this.progress.getStatus(jobId);
  }

  async getProgress(jobId: string) {
    const items = await this.progress.listItems(jobId);
    return computeProgress(items);
  }

  async resume(jobId: string, retryFailed = false): Promise<BatchRunResult> {
    const job = await this.progress.getJob(jobId);
    if (!job) {
      throw new Error(`Batch job not found: ${jobId}`);
    }
    this.cancelled.delete(jobId);
    return this.run(job.spec, jobId, { resume: true, retryFailed });
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelled.add(jobId);
    const status = await this.progress.getStatus(jobId);
    if (status) {
      await this.progress.saveStatus(jobId, {
        ...status,
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
    }
  }

  async getJob(jobId: string) {
    return this.progress.getJob(jobId);
  }

  private async resolveItems(spec: BatchJobSpec): Promise<WorkItem[]> {
    if (spec.input.type === 'file' && spec.input.path) {
      const lines = await this.progress.readInputFile(spec.input.path);
      return buildItemsFromLines(lines, spec.input.itemTemplate);
    }
    return spec.input.items.map((inputs, i) => ({
      id: `item-${String(i + 1).padStart(3, '0')}`,
      inputs,
    }));
  }

  private async executeItems(job: BatchJob, items: BatchItemRecord[]): Promise<void> {
    const jobId = job.metadata.id;
    const retry = job.spec.retry;
    const dryRun = job.spec.dryRun;

    await this.progress.saveStatus(jobId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      stats: computeProgress(items),
    });

    await runWithConcurrency({
      concurrency: job.spec.concurrency,
      items: items.filter((i) => i.status === 'pending').map((i) => ({ id: i.id, inputs: i.inputs })),
      shouldCancel: () => this.cancelled.has(jobId),
      process: async (workItem) => {
        let record = (await this.progress.getItem(jobId, workItem.id))!;
        if (record.status !== 'pending') return;

        record = { ...record, status: 'running', updatedAt: new Date().toISOString() };
        await this.progress.saveItem(jobId, record);
        await this.syncProgress(jobId);

        const maxAttempts = retry.maxAttempts;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          record.attempts = attempt;
          try {
            const result = await this.deps.blueprintRunner.run(job.spec.blueprint, record.inputs, {
              dryRun,
            });
            record = {
              ...record,
              status: 'completed',
              output: result.output ?? result.status,
              updatedAt: new Date().toISOString(),
            };
            await this.progress.saveItem(jobId, record);
            await this.syncProgress(jobId);
            return;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const retryable = isRetryableError(message, retry.retryOn);
            const isLast = attempt >= maxAttempts;

            if (retryable && !isLast) {
              await sleep(backoffDelay(attempt, retry.backoff, retry.delayMs));
              continue;
            }

            record = {
              ...record,
              status: 'failed',
              error: message,
              updatedAt: new Date().toISOString(),
            };
            await this.progress.saveItem(jobId, record);
            await this.syncProgress(jobId);
            return;
          }
        }
      },
    });

    const finalItems = await this.progress.listItems(jobId);
    const stats = computeProgress(finalItems);
    let status: BatchJobStatus = 'completed';
    if (this.cancelled.has(jobId)) {
      status = 'cancelled';
    } else if (stats.failed > 0 && stats.completed > 0) {
      status = 'partial';
    } else if (stats.failed > 0 && stats.completed === 0) {
      status = 'failed';
    }

    await this.progress.saveStatus(jobId, {
      status,
      startedAt: (await this.progress.getStatus(jobId))?.startedAt,
      completedAt: new Date().toISOString(),
      stats,
    });
    await this.progress.writeProgressJson(jobId, stats);
  }

  private async syncProgress(jobId: string): Promise<void> {
    const items = await this.progress.listItems(jobId);
    const stats = computeProgress(items);
    const status = await this.progress.getStatus(jobId);
    if (status) {
      await this.progress.saveStatus(jobId, { ...status, stats });
    }
    await this.progress.writeProgressJson(jobId, stats);
  }

  private async buildResult(jobId: string): Promise<BatchRunResult> {
    const status = await this.progress.getStatus(jobId);
    const items = await this.progress.listItems(jobId);
    const progress = computeProgress(items);
    return {
      jobId,
      status: status?.status ?? 'failed',
      progress,
      items,
    };
  }
}

export function createBatchEngine(deps: BatchEngineDeps): BatchEngine {
  return new BatchEngineImpl(deps);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
