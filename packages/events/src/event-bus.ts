import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  AckPolicy,
  DeliverPolicy,
} from 'nats';
import { createEvent, serializeEvent, deserializeEvent } from './envelope.js';
import type { AnvioEvent, EventSubject } from './types.js';

const STREAM_NAME = 'ANVIO';

export interface EventBusOptions {
  url: string;
  source: string;
}

export type EventHandler<T = unknown> = (event: AnvioEvent<T>) => Promise<void>;

export class EventBus {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private readonly source: string;

  constructor(private readonly options: EventBusOptions) {
    this.source = options.source;
  }

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.options.url });
    this.js = this.nc.jetstream();
    await this.ensureStream();
  }

  private async ensureStream(): Promise<void> {
    if (!this.nc) return;
    const jsm: JetStreamManager = await this.nc.jetstreamManager();
    try {
      await jsm.streams.info(STREAM_NAME);
    } catch {
      await jsm.streams.add({
        name: STREAM_NAME,
        subjects: ['anvio.>'],
      });
    }
  }

  async publish<T>(subject: EventSubject, type: string, data: T): Promise<void> {
    if (!this.js) throw new Error('EventBus not connected');
    const event = createEvent(type, this.source, data);
    await this.js.publish(subject, serializeEvent(event));
  }

  /** Fire-and-forget publish for real-time streaming (delivered to core subscribers). */
  async publishCore<T>(subject: EventSubject, type: string, data: T): Promise<void> {
    if (!this.nc) throw new Error('EventBus not connected');
    const event = createEvent(type, this.source, data);
    this.nc.publish(subject, serializeEvent(event));
  }

  async subscribe<T>(
    subject: EventSubject,
    durableName: string,
    handler: EventHandler<T>,
  ): Promise<() => Promise<void>> {
    if (!this.js || !this.nc) throw new Error('EventBus not connected');

    const jsm = await this.nc.jetstreamManager();
    try {
      await jsm.consumers.info(STREAM_NAME, durableName);
    } catch {
      await jsm.consumers.add(STREAM_NAME, {
        durable_name: durableName,
        filter_subject: subject,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
      });
    }

    const consumer = await this.js.consumers.get(STREAM_NAME, durableName);
    const messages = await consumer.consume();
    let running = true;

    (async () => {
      for await (const msg of messages) {
        if (!running) break;
        try {
          const event = deserializeEvent<T>(msg.data);
          await handler(event);
          msg.ack();
        } catch (error) {
          console.error('Event handler error:', error);
          msg.nak();
        }
      }
    })();

    return async () => {
      running = false;
      await messages.close();
    };
  }

  async subscribeCore<T>(subject: EventSubject, handler: EventHandler<T>): Promise<() => void> {
    if (!this.nc) throw new Error('EventBus not connected');
    const sub = this.nc.subscribe(subject);
    let running = true;

    (async () => {
      for await (const msg of sub) {
        if (!running) break;
        try {
          const event = deserializeEvent<T>(msg.data);
          await handler(event);
        } catch (error) {
          console.error('Core subscriber error:', error);
        }
      }
    })();

    return () => {
      running = false;
      sub.unsubscribe();
    };
  }

  async close(): Promise<void> {
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      this.js = null;
    }
  }
}
