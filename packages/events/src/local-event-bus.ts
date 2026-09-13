import type { AnvioEvent, EventSubject } from './types.js';
import { createEvent } from './envelope.js';
import type { EventHandler } from './event-bus.js';

/** In-process event bus for Level 1 — no NATS required. */
export class LocalEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private readonly source: string;

  constructor(source = '/anvio/local') {
    this.source = source;
  }

  async connect(): Promise<void> {}

  async publish<T>(subject: EventSubject, type: string, data: T): Promise<void> {
    await this.publishCore(subject, type, data);
  }

  async publishCore<T>(subject: EventSubject, type: string, data: T): Promise<void> {
    const event = createEvent(type, this.source, data);
    await this.dispatch(subject, event);
  }

  async subscribe<T>(
    subject: EventSubject,
    _durableName: string,
    handler: EventHandler<T>,
  ): Promise<() => Promise<void>> {
    const unsub = await this.subscribeCore(subject, handler);
    return async () => {
      unsub();
    };
  }

  async subscribeCore<T>(
    subject: EventSubject,
    handler: EventHandler<T>,
  ): Promise<() => void> {
    if (!this.handlers.has(subject)) {
      this.handlers.set(subject, new Set());
    }
    this.handlers.get(subject)!.add(handler as EventHandler);
    return () => {
      this.handlers.get(subject)?.delete(handler as EventHandler);
    };
  }

  /**
   * Handlers are isolated from one another. A bare sequential `await` meant a
   * single throwing subscriber rejected the `publish()` that started the run
   * and skipped every handler queued behind it — one Telegram `400 can't
   * parse entities` was enough to lose a reply and starve the rest of the
   * subject (issue #71).
   *
   * A handler failure is logged and the remaining handlers still run. This
   * mirrors at-least-once delivery on the NATS bus, where one consumer's
   * failure never blocks another's.
   */
  private async dispatch<T>(subject: string, event: AnvioEvent<T>): Promise<void> {
    const handlers = this.handlers.get(subject);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(
          `[events] Handler failed for ${subject}:`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
      }
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

export type EventBusLike = LocalEventBus | import('@anvio/events').EventBus;

export async function createEventBus(
  provider: string,
  options: { url?: string; source: string },
): Promise<EventBusLike> {
  if (provider === 'nats') {
    const { EventBus } = await import('@anvio/events');
    const bus = new EventBus({ url: options.url ?? 'nats://localhost:4222', source: options.source });
    await bus.connect();
    return bus;
  }
  return new LocalEventBus(options.source);
}
