import WebSocket from 'ws';

export interface RealtimeTranscriptEvent {
  text: string;
  final: boolean;
}

export interface RealtimeSttSession {
  feed(chunk: Buffer): void;
  end(): Promise<string>;
}

export interface OpenAiRealtimeSttOptions {
  apiKey?: string;
  model?: string;
  onPartial?: (text: string) => void;
  /** Override wss URL (tests, custom gateways). Defaults to OpenAI production. */
  url?: string;
}

/**
 * OpenAI Realtime API transcription session (WebSocket, live-streaming).
 * Auto-connects on first `feed()`; partials + final transcripts surface via
 * `events()`. Falls back to mock transcripts when OPENAI_API_KEY is unset.
 */
export class OpenAiRealtimeSttSession implements RealtimeSttSession {
  private readonly pending: Buffer[] = [];
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private partial = '';
  private finalText = '';
  private closed = false;
  private byteCount = 0;

  private readonly waiters: Array<(event: RealtimeTranscriptEvent | null) => void> = [];
  private readonly queue: RealtimeTranscriptEvent[] = [];

  constructor(private readonly options: OpenAiRealtimeSttOptions = {}) {}

  feed(chunk: Buffer): void {
    if (this.closed) return;
    this.byteCount += chunk.length;

    const key = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      this.pending.push(chunk);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendChunk(chunk);
      return;
    }
    this.pending.push(chunk);
    if (!this.connectPromise) {
      this.connectPromise = this.connect(key).catch((err) => {
        this.emitError(err instanceof Error ? err.message : String(err));
      });
    }
  }

  async end(): Promise<string> {
    const key = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      this.closed = true;
      this.notifyWaiters();
      return `[realtime-stub] transcribed ${this.byteCount} bytes of audio`;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.connect(key).catch((err) => {
        this.emitError(err instanceof Error ? err.message : String(err));
      });
    }
    await this.connectPromise;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      this.ws.send(JSON.stringify({ type: 'response.create' }));
      await this.waitForClose(30_000);
    }

    this.closed = true;
    this.notifyWaiters();
    return this.finalText || this.partial || '';
  }

  /** Async iterator over partial + final transcript events. Ends after `end()` resolves. */
  async *events(): AsyncGenerator<RealtimeTranscriptEvent> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed && this.queue.length === 0) return;
      const next = await new Promise<RealtimeTranscriptEvent | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return;
      yield next;
    }
  }

  private sendChunk(chunk: Buffer): void {
    this.ws!.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: chunk.toString('base64'),
      }),
    );
  }

  private emit(event: RealtimeTranscriptEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(event);
    else this.queue.push(event);
  }

  private notifyWaiters(): void {
    while (this.waiters.length > 0) this.waiters.shift()!(null);
  }

  private emitError(message: string): void {
    this.emit({ text: `[error] ${message}`, final: true });
    this.closed = true;
    this.notifyWaiters();
  }

  private connect(apiKey: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();

    const model =
      this.options.model ?? process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-mini-transcribe';
    const url =
      this.options.url ??
      `wss://api.openai.com/v1/realtime?intent=transcription&model=${encodeURIComponent(model)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
      this.ws = ws;

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              input_audio_format: 'pcm16',
              input_audio_transcription: { model },
              turn_detection: null,
            },
          }),
        );
        while (this.pending.length > 0) {
          this.sendChunk(this.pending.shift()!);
        }
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString()) as {
            type?: string;
            delta?: string;
            transcript?: string;
            error?: { message?: string };
          };
          switch (event.type) {
            case 'conversation.item.input_audio_transcription.delta':
              if (event.delta) {
                this.partial += event.delta;
                this.options.onPartial?.(this.partial);
                this.emit({ text: this.partial, final: false });
              }
              break;
            case 'conversation.item.input_audio_transcription.completed':
              if (event.transcript) {
                this.finalText = event.transcript;
                this.partial = event.transcript;
                this.options.onPartial?.(event.transcript);
              }
              this.emit({ text: this.finalText, final: true });
              this.closed = true;
              this.notifyWaiters();
              ws.close();
              break;
            case 'error':
              this.emitError(event.error?.message ?? 'realtime error');
              ws.close();
              break;
            default:
              break;
          }
        } catch {
          /* ignore malformed frames */
        }
      });

      ws.on('error', (err) => {
        this.emitError(err instanceof Error ? err.message : String(err));
        reject(err);
      });
      ws.on('close', () => {
        this.closed = true;
        this.notifyWaiters();
      });
    });
  }

  private waitForClose(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (this.closed || Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }
}

export function createRealtimeSttSession(options?: OpenAiRealtimeSttOptions): RealtimeSttSession {
  return new OpenAiRealtimeSttSession(options);
}

/** Stream partial + final transcripts from a realtime session, live. */
export async function* streamRealtimeTranscribe(
  session: OpenAiRealtimeSttSession,
  chunkSource: AsyncIterable<Buffer>,
): AsyncGenerator<RealtimeTranscriptEvent> {
  const pump = (async () => {
    for await (const chunk of chunkSource) {
      session.feed(chunk);
    }
    await session.end();
  })();

  try {
    for await (const event of session.events()) {
      yield event;
    }
  } finally {
    await pump;
  }
}
