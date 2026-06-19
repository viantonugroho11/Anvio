import type {
  BatchItemRecord,
  BatchJob,
  BatchJobSpec,
  BatchProgress,
  BatchStatusFile,
} from '../schemas/batch.schema.js';

export interface BatchRunOptions {
  resume?: boolean;
  retryFailed?: boolean;
  dryRun?: boolean;
}

export interface BatchRunResult {
  jobId: string;
  status: BatchStatusFile['status'];
  progress: BatchProgress;
  items: BatchItemRecord[];
}

export interface BatchEngine {
  run(spec: BatchJobSpec, jobId?: string, options?: BatchRunOptions): Promise<BatchRunResult>;
  getStatus(jobId: string): Promise<BatchStatusFile | null>;
  getProgress(jobId: string): Promise<BatchProgress | null>;
  resume(jobId: string, retryFailed?: boolean): Promise<BatchRunResult>;
  cancel(jobId: string): Promise<void>;
  getJob(jobId: string): Promise<BatchJob | null>;
}

export interface BlueprintRunner {
  run(blueprint: string, inputs: Record<string, unknown>, options?: { dryRun?: boolean }): Promise<{
    status: string;
    output?: unknown;
  }>;
}
