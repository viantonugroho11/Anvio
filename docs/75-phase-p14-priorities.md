# Phase P14 — Research & remaining P12 polish

**Status:** shipped (v1.19.0)  
**Depends on:** v1.18.0 + P13 (main)

## P12 partial — closed in P14

| Item | Deliverable |
|------|-------------|
| MCP preset E2E | All 3 presets tested in `phase-p14.integration.spec.ts` |
| browser_cdp grant | `ANVIO_BROWSER_CDP_GRANT=1` extended methods |
| Harness snapshots | `harness-channel-format.integration.spec.ts` |
| Google Chat SA | JWT auth + REST in `google-chat.ts` |
| Teams/Matrix hardening | `fetchWithRetry` backoff |
| Feishu/SMS channels | `FeishuChannel`, `SmsChannel` (Twilio) |
| Workflow→skill | [74-workflow-to-skill-example.md](./74-workflow-to-skill-example.md) |
| Langfuse dashboard | [configs/observability/langfuse-dashboard.json](../configs/observability/langfuse-dashboard.json) |

## P14 research

| Item | Deliverable |
|------|-------------|
| Trajectory export | `anvio session export <id> [--md]` |
| Desktop shell | [apps/desktop/README.md](../apps/desktop/README.md) scaffold |

## Still deferred (P15+)

- ~~OpenAI Realtime WebSocket STT~~ ✅ shipped — full live-streaming refactor: `OpenAiRealtimeSttSession` auto-connects on first `feed()`, drains buffered chunks post-open, emits real `conversation.item.input_audio_transcription.delta` events via new `events()` async iterator, `streamRealtimeTranscribe` yields real partial+final transcripts, `streamTranscribe` in `streaming-stt.ts` delegates to realtime path when session is `OpenAiRealtimeSttSession`. Coverage in `openai-realtime-stt.spec.ts` (mock WebSocket server round-trip)
- Live MCP server E2E (Spotify/Feishu credentials)
- Nous Portal OAuth
- Full native IMAP IDLE protocol (vs poll loop)
