# Voice Mode (Phase I → v1.20)

Real-time STT/TTS pipeline in `@anvio/voice`.

## CLI

```bash
anvio voice speak Hello from Anvio
anvio voice transcribe recording.wav
anvio voice stream-transcribe recording.ogg    # chunked Whisper
anvio voice realtime-transcribe recording.wav  # OpenAI Realtime WebSocket
```

Without `OPENAI_API_KEY`, adapters return deterministic stubs for local testing.

## Pipeline

`VoicePipeline` composes:

1. **STT** — OpenAI Whisper API (`whisper-1`) or Realtime WebSocket
2. **TTS** — OpenAI speech API (`tts-1`)

```typescript
const pipeline = new VoicePipeline();
const turn = await pipeline.turn('input.wav', async (text) => `You said: ${text}`);
```

## OpenAI Realtime STT (v1.20)

WebSocket transcription via `wss://api.openai.com/v1/realtime?intent=transcription`.

```bash
export OPENAI_API_KEY=sk-...
export ANVIO_VOICE_REALTIME=1          # auto-select realtime in stream-transcribe
export OPENAI_REALTIME_MODEL=gpt-4o-mini-transcribe   # optional
anvio voice realtime-transcribe live.ogg
```

Channel voice notes (Telegram/Discord) can set `ANVIO_VOICE_REALTIME=1` for lower-latency transcription.

## Related

- [76-unified-gateway.md](./76-unified-gateway.md)
