# Phase P2 — Voice & Channel Breadth (2026)

**Status:** Active  
**Scope:** Voice on channels + Mattermost adapter. **Desktop (DT) deferred** as optional P3.

---

## Priority stack

| ID | Deliverable | Status |
|----|-------------|--------|
| C1 | Mattermost channel adapter | ✅ Phase P2 |
| V2 | Telegram voice note → transcript | ✅ Phase P2 |
| V3 | Discord audio attachment → transcript | ✅ Phase P2 |
| V1 | CLI STT/TTS (OpenAI) | ✅ existing |
| DT | Desktop app | ⏸ optional / P3 |

---

## Voice on channels

Enable globally or per channel in `workspace/anvio.yaml`:

```yaml
spec:
  channels:
    voice:
      enabled: true
    telegram:
      enabled: true
      botToken: ${TELEGRAM_BOT_TOKEN}
      voice:
        enabled: true
    discord:
      enabled: true
      botToken: ${DISCORD_BOT_TOKEN}
      voice:
        enabled: true
```

Or set `ANVIO_CHANNEL_VOICE=1` with `OPENAI_API_KEY` for Whisper transcription.

**Flow:** voice/audio inbound → Whisper STT → `[voice] {transcript}` → agent runtime.

---

## Mattermost

```yaml
spec:
  channels:
    mattermost:
      enabled: true
      serverUrl: https://mattermost.example.com
      botToken: ${MATTERMOST_BOT_TOKEN}
```

Env: `MATTERMOST_SERVER_URL`, `MATTERMOST_BOT_TOKEN`

**CLI:** `anvio channels status` probes Mattermost `/api/v4/users/me`.

---

## Related

- [41-channel-harness.md](./41-channel-harness.md)
- [53-phase-p1-priorities.md](./53-phase-p1-priorities.md)
- [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md)
