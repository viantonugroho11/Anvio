# Phase P13 — Remote runtimes, voice streaming, email depth

**Status:** shipped (v1.19.0)  
**Depends on:** v1.18.0 (Phase P12)

## Goals

Close remote runtime, voice streaming, and email channel gaps from [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md).

## P13 deliverables

| Track | ID | Deliverable | Status |
|-------|-----|-------------|--------|
| Remote | P13-R1 | `SshRuntimeProvider.execRemote` + CLI | ✅ |
| Remote | P13-R2 | Daytona/Modal `execRemote` (mock + HTTP) | ✅ |
| Voice | P13-V1 | `ChunkedStreamingSttSession` + `streamTranscribe` | ✅ |
| Voice | P13-V2 | `anvio voice stream-transcribe` | ✅ |
| Email | P13-E1 | IMAP IDLE watch loop (`EMAIL_IMAP_IDLE=1`) | ✅ |
| Email | P13-E2 | Message-ID / References thread routing | ✅ |

## Usage

```bash
ANVIO_SSH_MOCK=1 anvio runtime exec ssh -- echo hello
ANVIO_DAYTONA_MOCK=1 anvio runtime exec daytona -- uname -a
EMAIL_IMAP_IDLE=1 anvio worker   # worker starts idle watch when IMAP configured
anvio voice stream-transcribe sample.ogg
```

## Out of scope (P14+)

- Full OpenAI Realtime WebSocket STT
- Desktop app
- Trajectory export
