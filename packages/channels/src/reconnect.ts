/**
 * Reconnect loop for socket-based adapters (Slack Socket Mode, Discord Gateway).
 *
 * The adapters used to `setTimeout(() => void this.start(), 5000)` from `onclose`.
 * That reconnected after `stop()` (closing the socket fires `onclose`), and a
 * rejected `start()` was voided, so one failed reconnect left the bot offline
 * until the process restarted (audit CQ-008). This keeps trying with capped,
 * jittered exponential backoff until `stop()`.
 */
export class ReconnectScheduler {
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(
    private readonly label: string,
    private readonly connect: () => Promise<void>,
    private readonly options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
  ) {}

  get isStopped(): boolean {
    return this.stopped;
  }

  /** Allow reconnects (call from `start()`). */
  begin(): void {
    this.stopped = false;
  }

  /** Stop for good: cancels a pending reconnect and refuses new ones. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The connection is healthy again; the next drop starts from the base delay. */
  connected(): void {
    this.attempt = 0;
  }

  /** Delay the next attempt would wait, for logs and tests. */
  nextDelayMs(): number {
    const base = this.options.baseMs ?? 1_000;
    const max = this.options.maxMs ?? 60_000;
    const random = this.options.random ?? Math.random;
    const exp = Math.min(max, base * 2 ** this.attempt);
    return Math.round(exp * (0.5 + random() * 0.5));
  }

  schedule(reason: string): void {
    if (this.stopped || this.timer) return;
    const delay = this.nextDelayMs();
    this.attempt++;
    console.log(
      `[${this.label}] ${reason}; reconnecting in ${Math.round(delay / 100) / 10}s (attempt ${this.attempt})`,
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped) return;
      this.connect().catch((error: unknown) => {
        console.error(
          `[${this.label}] reconnect failed:`,
          error instanceof Error ? error.message : error,
        );
        this.schedule('reconnect failed');
      });
    }, delay);
    this.timer.unref?.();
  }
}

/** Remembers the last `capacity` ids, for dropping redelivered events. */
export class RecentIds {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity = 1_000) {}

  /** Returns true the first time an id is seen, false for a repeat. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}
