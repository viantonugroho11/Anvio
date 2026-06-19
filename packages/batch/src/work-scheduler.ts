export interface WorkItem<T = Record<string, unknown>> {
  id: string;
  inputs: T;
}

export interface WorkSchedulerOptions<T> {
  concurrency: number;
  items: WorkItem<T>[];
  process: (item: WorkItem<T>) => Promise<void>;
  shouldCancel?: () => boolean;
}

export async function runWithConcurrency<T>(options: WorkSchedulerOptions<T>): Promise<void> {
  const { concurrency, items, process, shouldCancel } = options;
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      if (shouldCancel?.()) break;
      const current = items[index];
      index += 1;
      if (!current) break;
      await process(current);
    }
  });

  await Promise.all(workers);
}

export function buildItemsFromLines(
  lines: string[],
  template?: Record<string, string>,
): WorkItem[] {
  return lines.map((line, i) => {
    const inputs: Record<string, unknown> = { line };
    if (template) {
      for (const [key, value] of Object.entries(template)) {
        inputs[key] = value.replace(/\{\{line\}\}/g, line);
      }
    }
    return { id: `item-${String(i + 1).padStart(3, '0')}`, inputs };
  });
}

export function backoffDelay(
  attempt: number,
  mode: 'fixed' | 'exponential',
  baseMs: number,
): number {
  if (mode === 'fixed') return baseMs;
  return Math.min(baseMs * 2 ** (attempt - 1), 30_000);
}

export function isRetryableError(error: string, retryOn: string[]): boolean {
  const lower = error.toLowerCase();
  return retryOn.some((pattern) => lower.includes(pattern.replace('_', ' ')) || lower.includes(pattern));
}
