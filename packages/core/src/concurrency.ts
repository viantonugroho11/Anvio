/**
 * Runs tasks one at a time per key, in submission order; different keys run
 * concurrently. Used to keep two turns of one session from interleaving — each
 * reads the history and writes it back whole, so the later write used to discard
 * the earlier turn (audit CQ-007).
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  /** True while a task for `key` is running or waiting. */
  isBusy(key: string): boolean {
    return this.tails.has(key);
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/** Counting semaphore: at most `limit` holders at once, FIFO for waiters. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error(`Semaphore limit must be >= 1 (got ${limit})`);
  }

  get inUse(): number {
    return this.active;
  }

  async use<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }
}
