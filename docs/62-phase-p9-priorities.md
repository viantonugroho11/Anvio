# Phase P9 — Token usage, MCP reconnect, SMTP, Teams cards

**Status:** shipped in v1.14.0  
**Depends on:** P8 (MCP stdio, channel E2E)

## Goals

1. **P9a — Token usage tracking** end-to-end with audit ledger.
2. **P9b — MCP stdio reconnect** after process exit.
3. **P9c — Email SMTP outbound** (remaining P8).
4. **P9d — Teams Adaptive Cards** for approval actions (remaining P8).

## P9a — Token usage

| Layer | Implementation |
|-------|----------------|
| Core | `addTokenUsage()` sums across tool-loop iterations |
| Providers | Gemini + OpenAI stream parse `usageMetadata` / `usage` from SSE |
| Runtime | `DefaultAgentRuntime` accumulates per iteration |
| Worker | `finalizeAgentRun()` publishes `AGENT_RUN_COMPLETED` |
| Audit | `workspace/audit/tokens.jsonl` via `TokenUsageAudit` |

Record shape:

```json
{"ts":"2026-06-19T12:00:00.000Z","sessionId":"...","channel":"cli","agentId":"architect","usage":{"inputTokens":100,"outputTokens":50,"totalTokens":150},"estimatedCostUsd":0.001}
```

Optional cost estimate for known models (`claude-sonnet-4-20250514`, `gpt-4o`, `gemini-2.0-flash`).

## P9b — MCP reconnect

- `McpStdioClient.invalidate()` + auto-restart in `ensureRunning()` (max 3 restarts)
- `McpBridge` drops cached client on stdio failure

## P9c — Email SMTP

- `sendSmtpMail()` — STARTTLS + AUTH LOGIN on port 587
- `EmailChannel.deliverMessage` sends when `smtpHost` + `username` configured

## P9d — Teams Adaptive Cards

- `TeamsChannel.sendApprovalRequestWithActions` posts Adaptive Card with Approve/Reject
- `handleInvokeActivity` routes `Action.Submit` to `onApproval` callback

## Remaining (P11+)

See [Phase P10](./63-phase-p10-priorities.md) for completed P9 follow-ups.
