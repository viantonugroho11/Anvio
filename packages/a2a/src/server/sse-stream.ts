import type { ServerResponse } from 'node:http';
import type { StreamEvent } from '../types/index.js';

/**
 * Manages an SSE connection for A2A task streaming.
 */
export class SseStream {
  private closed = false;

  constructor(private readonly res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.on('close', () => {
      this.closed = true;
    });
  }

  send(event: StreamEvent): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  sendRaw(eventType: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }

  get isOpen(): boolean {
    return !this.closed;
  }
}
