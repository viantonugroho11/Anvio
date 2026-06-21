import { OpenAiSpeechAdapter } from './adapters/openai-speech.js';
import { createRealtimeSttSession } from './adapters/openai-realtime-stt.js';

export interface StreamingSttChunk {
  text: string;
  final: boolean;
}

export interface StreamingSttSession {
  feed(chunk: Buffer): void;
  end(): Promise<string>;
}

export interface CreateStreamingSttOptions {
  realtime?: boolean;
  onPartial?: (text: string) => void;
}

/** Accumulates audio chunks then transcribes (OpenAI Whisper) or mock. */
export class ChunkedStreamingSttSession implements StreamingSttSession {
  private readonly chunks: Buffer[] = [];

  constructor(private readonly adapter = new OpenAiSpeechAdapter()) {}

  feed(chunk: Buffer): void {
    this.chunks.push(chunk);
  }

  async end(): Promise<string> {
    const combined = Buffer.concat(this.chunks);
    return this.adapter.transcribe({
      audioBase64: combined.toString('base64'),
      mimeType: 'audio/ogg',
    });
  }
}

/** Yields partial transcript chunks for UI/streaming consumers. */
export async function* streamTranscribe(
  session: StreamingSttSession,
  chunkSource: AsyncIterable<Buffer>,
): AsyncGenerator<StreamingSttChunk> {
  for await (const chunk of chunkSource) {
    session.feed(chunk);
    yield { text: `[partial:${chunk.length}b]`, final: false };
  }
  const text = await session.end();
  yield { text, final: true };
}

export function createStreamingSttSession(options: CreateStreamingSttOptions = {}): StreamingSttSession {
  if (options.realtime || process.env.ANVIO_VOICE_REALTIME === '1') {
    return createRealtimeSttSession({ onPartial: options.onPartial });
  }
  return new ChunkedStreamingSttSession();
}
