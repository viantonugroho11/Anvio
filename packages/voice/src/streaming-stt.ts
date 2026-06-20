import { OpenAiSpeechAdapter } from './adapters/openai-speech.js';

export interface StreamingSttChunk {
  text: string;
  final: boolean;
}

export interface StreamingSttSession {
  feed(chunk: Buffer): void;
  end(): Promise<string>;
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

export function createStreamingSttSession(): StreamingSttSession {
  return new ChunkedStreamingSttSession();
}
