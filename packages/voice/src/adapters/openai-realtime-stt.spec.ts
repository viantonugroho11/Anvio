import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { OpenAiRealtimeSttSession, streamRealtimeTranscribe } from './openai-realtime-stt.js';

function bufIter(chunks: Buffer[]): AsyncIterable<Buffer> {
  return (async function* () {
    for (const c of chunks) {
      await new Promise((r) => setTimeout(r, 5));
      yield c;
    }
  })();
}

describe('OpenAiRealtimeSttSession stub (no API key)', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  beforeAll(() => {
    delete process.env.OPENAI_API_KEY;
  });
  afterAll(() => {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
  });

  it('returns byte count stub when no API key present', async () => {
    const session = new OpenAiRealtimeSttSession();
    session.feed(Buffer.from('abcd'));
    session.feed(Buffer.from('efgh'));
    const text = await session.end();
    expect(text).toBe('[realtime-stub] transcribed 8 bytes of audio');
  });
});

describe('OpenAiRealtimeSttSession live (mock WebSocket server)', () => {
  let server: WebSocketServer;
  let url: string;
  const receivedAppends: string[] = [];

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    url = `ws://127.0.0.1:${port}`;

    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input_audio_buffer.append') {
          receivedAppends.push(msg.audio);
        }
        if (msg.type === 'input_audio_buffer.commit') {
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.delta',
              delta: 'hello ',
            }),
          );
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.delta',
              delta: 'world',
            }),
          );
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.completed',
              transcript: 'hello world',
            }),
          );
        }
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('auto-connects on first feed, streams deltas + final via events()', async () => {
    receivedAppends.length = 0;
    const session = new OpenAiRealtimeSttSession({ apiKey: 'test-key', url });
    session.feed(Buffer.from('chunk-1'));
    session.feed(Buffer.from('chunk-2'));

    const collected: Array<{ text: string; final: boolean }> = [];
    const consumer = (async () => {
      for await (const event of session.events()) {
        collected.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 50));
    const final = await session.end();
    await consumer;

    expect(final).toBe('hello world');
    expect(collected.some((e) => !e.final && e.text === 'hello ')).toBe(true);
    expect(collected.some((e) => !e.final && e.text === 'hello world')).toBe(true);
    expect(collected.at(-1)).toEqual({ text: 'hello world', final: true });
    expect(receivedAppends.length).toBe(2);
    expect(Buffer.from(receivedAppends[0], 'base64').toString()).toBe('chunk-1');
  });

  it('streamRealtimeTranscribe yields real partials from source', async () => {
    receivedAppends.length = 0;
    const session = new OpenAiRealtimeSttSession({ apiKey: 'test-key', url });
    const events: Array<{ text: string; final: boolean }> = [];
    for await (const event of streamRealtimeTranscribe(
      session,
      bufIter([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]),
    )) {
      events.push(event);
    }
    expect(events.some((e) => e.text === 'hello ')).toBe(true);
    const finalEvent = events.at(-1);
    expect(finalEvent?.final).toBe(true);
    expect(finalEvent?.text).toBe('hello world');
  });

  it('onPartial callback receives cumulative partial + final', async () => {
    const partials: string[] = [];
    const session = new OpenAiRealtimeSttSession({
      apiKey: 'test-key',
      url,
      onPartial: (t) => partials.push(t),
    });
    session.feed(Buffer.from('x'));
    await new Promise((r) => setTimeout(r, 30));
    await session.end();
    expect(partials).toEqual(['hello ', 'hello world', 'hello world']);
  });
});
