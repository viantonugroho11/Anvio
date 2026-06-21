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
}

/**
 * OpenAI Realtime API transcription session (WebSocket).
 * Falls back to mock transcripts when OPENAI_API_KEY is unset.
 */
export class OpenAiRealtimeSttSession implements RealtimeSttSession {
  private readonly chunks: Buffer[] = [];
  private ws: WebSocket | null = null;
  private partial = '';
  private finalText = '';
  private closed = false;

  constructor(private readonly options: OpenAiRealtimeSttOptions = {}) {}

  feed(chunk: Buffer): void {
    this.chunks.push(chunk);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: chunk.toString('base64'),
        }),
      );
    }
  }

  async end(): Promise<string> {
    const key = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      const combined = Buffer.concat(this.chunks);
      return `[realtime-stub] transcribed ${combined.length} bytes of audio`;
    }

    await this.connect(key);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      this.ws.send(JSON.stringify({ type: 'response.create' }));
      await this.waitForClose(30_000);
    }

    return this.finalText || this.partial || '';
  }

  private connect(apiKey: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();

    const model = this.options.model ?? process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-mini-transcribe';
    const url = `wss://api.openai.com/v1/realtime?intent=transcription&model=${encodeURIComponent(model)}`;

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
        for (const chunk of this.chunks) {
          ws.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: chunk.toString('base64'),
            }),
          );
        }
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString()) as {
            type?: string;
            delta?: string;
            transcript?: string;
          };
          switch (event.type) {
            case 'conversation.item.input_audio_transcription.delta':
              if (event.delta) {
                this.partial += event.delta;
                this.options.onPartial?.(this.partial);
              }
              break;
            case 'conversation.item.input_audio_transcription.completed':
              if (event.transcript) {
                this.finalText = event.transcript;
                this.partial = event.transcript;
                this.options.onPartial?.(event.transcript);
              }
              this.closed = true;
              ws.close();
              break;
            case 'error':
              this.closed = true;
              ws.close();
              break;
            default:
              break;
          }
        } catch {
          /* ignore malformed frames */
        }
      });

      ws.on('error', reject);
      ws.on('close', () => {
        this.closed = true;
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

/** Stream partial + final transcripts from a realtime session. */
export async function* streamRealtimeTranscribe(
  session: OpenAiRealtimeSttSession,
  chunkSource: AsyncIterable<Buffer>,
): AsyncGenerator<RealtimeTranscriptEvent> {
  for await (const chunk of chunkSource) {
    session.feed(chunk);
    yield { text: `[streaming:${chunk.length}b]`, final: false };
  }
  const text = await session.end();
  yield { text, final: true };
}
