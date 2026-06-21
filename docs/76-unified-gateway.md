# Unified Gateway (Hermes-style)

**Status:** shipped (v1.20.0)

One daemon replaces the separate worker + API + WebSocket stack — equivalent to Hermes `GatewayRunner`.

## Start

```bash
# Background daemon (writes workspace/.gateway/gateway.pid)
anvio gateway start

# Foreground (Ctrl+C to stop)
anvio gateway start --foreground

anvio gateway status
anvio gateway stop
```

## What runs in one process

| Component | Endpoint / role |
|-----------|-----------------|
| Channel Hub | Telegram, Slack, Discord, … |
| Agent worker | Detached runs, approvals, inbox |
| REST API | `/api/sessions`, webhooks |
| WebSocket | `/ws?sessionId=<id>` |
| Cron / automation | Built-in scheduler |
| Harness | Channel formatting + soul gate |

Default port: **3001** (`ANVIO_GATEWAY_PORT`).

## SQLite sessions (Hermes `state.db`)

Set in `workspace/anvio.yaml`:

```yaml
spec:
  storage:
    provider: sqlite
    basePath: .
    # connectionString: sqlite:./state.db   # optional override
```

Sessions persist in `workspace/state.db` with **FTS5** message search (`session_search` tool uses FTS when enabled).

## OpenAI Realtime STT

```bash
export OPENAI_API_KEY=sk-...
export ANVIO_VOICE_REALTIME=1   # or pass --realtime
anvio voice realtime-transcribe sample.wav
```

Uses OpenAI Realtime WebSocket (`wss://api.openai.com/v1/realtime?intent=transcription`).

Env: `OPENAI_REALTIME_MODEL` (default `gpt-4o-mini-transcribe`).

## Migration from worker + API

| Before | After |
|--------|-------|
| `pnpm --filter @anvio/worker dev` | `anvio gateway start` |
| `pnpm --filter @anvio/api dev` | included in gateway |
| `pnpm --filter @anvio/gateway dev` | included in gateway |

Legacy split processes still work for development; unified gateway is recommended for production.

## Related

- [41-channel-harness.md](./41-channel-harness.md)
- [48-voice-mode.md](./48-voice-mode.md)
- [50-hermes-slaude-parity.md](./50-hermes-slaude-parity.md)
