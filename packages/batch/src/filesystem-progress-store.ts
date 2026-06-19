import type { BatchItemRecord, BatchJob, BatchProgress, BatchStatusFile } from '@anvio/core';
import { parseBatchItemRecord, parseBatchJob, parseBatchStatusFile } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export class FilesystemProgressStore {
  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly workspaceRoot: string,
  ) {}

  jobDir(jobId: string): string {
    return `batch/${jobId}`;
  }

  async saveJob(job: BatchJob): Promise<void> {
    await this.storage.write(`${this.jobDir(job.metadata.id)}/job.yaml`, stringifyYaml(job));
  }

  async getJob(jobId: string): Promise<BatchJob | null> {
    const raw = await this.storage.read(`${this.jobDir(jobId)}/job.yaml`);
    if (!raw) return null;
    return parseBatchJob(parseYaml(raw));
  }

  async saveStatus(jobId: string, status: BatchStatusFile): Promise<void> {
    await this.storage.write(`${this.jobDir(jobId)}/status.yaml`, stringifyYaml(status));
  }

  async getStatus(jobId: string): Promise<BatchStatusFile | null> {
    const raw = await this.storage.read(`${this.jobDir(jobId)}/status.yaml`);
    if (!raw) return null;
    return parseBatchStatusFile(parseYaml(raw));
  }

  async saveItem(jobId: string, item: BatchItemRecord): Promise<void> {
    await this.storage.write(`${this.jobDir(jobId)}/items/${item.id}.yaml`, stringifyYaml(item));
  }

  async getItem(jobId: string, itemId: string): Promise<BatchItemRecord | null> {
    const raw = await this.storage.read(`${this.jobDir(jobId)}/items/${itemId}.yaml`);
    if (!raw) return null;
    return parseBatchItemRecord(parseYaml(raw));
  }

  async listItems(jobId: string): Promise<BatchItemRecord[]> {
    const files = await this.storage.list(`${this.jobDir(jobId)}/items`);
    const items: BatchItemRecord[] = [];
    for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      items.push(parseBatchItemRecord(parseYaml(raw)));
    }
    return items;
  }

  async writeProgressJson(jobId: string, progress: BatchProgress): Promise<void> {
    const fullPath = path.join(this.workspaceRoot, this.jobDir(jobId), 'progress.json');
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(progress, null, 2), 'utf8');
  }

  async readInputFile(relativePath: string): Promise<string[]> {
    const fullPath = path.join(this.workspaceRoot, relativePath);
    const content = await fs.readFile(fullPath, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }
}

export function computeProgress(items: BatchItemRecord[]): BatchProgress {
  const stats: BatchProgress = {
    total: items.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    inProgress: 0,
  };

  for (const item of items) {
    switch (item.status) {
      case 'completed':
        stats.completed += 1;
        break;
      case 'failed':
        stats.failed += 1;
        break;
      case 'skipped':
        stats.skipped += 1;
        break;
      case 'running':
        stats.inProgress += 1;
        break;
      default:
        break;
    }
  }

  return stats;
}
