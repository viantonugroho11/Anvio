import { z } from 'zod';

export const batchJobStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'partial',
  'cancelled',
]);

export const batchItemStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export const batchInputSchema = z.object({
  type: z.enum(['file', 'inline']).default('inline'),
  path: z.string().optional(),
  items: z.array(z.record(z.unknown())).default([]),
  itemTemplate: z.record(z.string()).optional(),
});

export const batchRetrySchema = z.object({
  maxAttempts: z.number().int().min(1).default(3),
  backoff: z.enum(['fixed', 'exponential']).default('exponential'),
  delayMs: z.number().int().min(0).default(1000),
  retryOn: z.array(z.string()).default(['timeout', 'rate_limit']),
});

export const batchJobSpecSchema = z.object({
  name: z.string().min(1),
  blueprint: z.string().min(1),
  input: batchInputSchema,
  concurrency: z.number().int().min(1).default(3),
  retry: batchRetrySchema.default({}),
  dryRun: z.boolean().default(false),
});

export const batchJobSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('BatchJob'),
  metadata: z.object({
    id: z.string().min(1),
    createdAt: z.string().optional(),
  }),
  spec: batchJobSpecSchema,
});

export const batchProgressSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  inProgress: z.number().int().min(0),
});

export const batchStatusFileSchema = z.object({
  status: batchJobStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  stats: batchProgressSchema,
});

export const batchItemRecordSchema = z.object({
  id: z.string().min(1),
  status: batchItemStatusSchema,
  attempts: z.number().int().min(0).default(0),
  inputs: z.record(z.unknown()).default({}),
  output: z.unknown().optional(),
  error: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type BatchJobStatus = z.infer<typeof batchJobStatusSchema>;
export type BatchItemStatus = z.infer<typeof batchItemStatusSchema>;
export type BatchJob = z.infer<typeof batchJobSchema>;
export type BatchJobSpec = z.infer<typeof batchJobSpecSchema>;
export type BatchProgress = z.infer<typeof batchProgressSchema>;
export type BatchStatusFile = z.infer<typeof batchStatusFileSchema>;
export type BatchItemRecord = z.infer<typeof batchItemRecordSchema>;

export function parseBatchJob(input: unknown): BatchJob {
  return batchJobSchema.parse(input);
}

export function parseBatchStatusFile(input: unknown): BatchStatusFile {
  return batchStatusFileSchema.parse(input);
}

export function parseBatchItemRecord(input: unknown): BatchItemRecord {
  return batchItemRecordSchema.parse(input);
}
