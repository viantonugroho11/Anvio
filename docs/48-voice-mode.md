# Voice Mode (Phase I)

Real-time STT/TTS pipeline in `@anvio/voice`.

## CLI

```bash
anvio voice speak Hello from Anvio
anvio voice transcribe recording.wav
```

Without `OPENAI_API_KEY`, adapters return deterministic stubs for local testing.

## Pipeline

`VoicePipeline` composes:

1. **STT** — OpenAI Whisper API (`whisper-1`)
2. **TTS** — OpenAI speech API (`tts-1`)

```typescript
const pipeline = new VoicePipeline();
const turn = await pipeline.turn('input.wav', async (text) => `You said: ${text}`);
```

Channel voice notes (Telegram/Discord) reuse the same pipeline via harness output adapters (future wiring).
