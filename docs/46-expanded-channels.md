# Expanded Channels (Phase I)

New adapters on the Phase G harness stack:

| Channel | Adapter | Mode |
|---------|---------|------|
| Microsoft Teams | `TeamsChannel` | In-memory + Bot Framework when `TEAMS_*` set |
| Matrix | `MatrixChannel` | In-memory + Client-Server API when `MATRIX_*` set |
| Email | `EmailChannel` | Outbound queue (SMTP config) |
| Signal | `SignalChannel` | signal-cli stub |
| Google Chat | `GoogleChatChannel` | Incoming webhook |

Teams and Matrix are always registered (in-memory) so harness approval/engagement tests work without live credentials.

## Environment

```bash
TEAMS_APP_ID TEAMS_APP_PASSWORD TEAMS_SERVICE_URL
MATRIX_HOMESERVER_URL MATRIX_ACCESS_TOKEN MATRIX_ROOM_ID
EMAIL_SMTP_HOST EMAIL_USERNAME EMAIL_PASSWORD
SIGNAL_CLI_PATH SIGNAL_PHONE_NUMBER
GOOGLE_CHAT_WEBHOOK_URL
```

## Health

```bash
anvio channels status
```

Probes include all Phase I channels via `probeAllChannels`.
