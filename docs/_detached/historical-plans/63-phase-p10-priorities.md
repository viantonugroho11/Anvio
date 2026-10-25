# Phase P10 — Usage CLI, IMAP, MCP health, Prometheus metrics

**Status:** shipped in v1.15.0  
**Depends on:** P9 (token audit ledger)

## Goals

1. **P10a — `anvio usage stats`** — aggregate `audit/tokens.jsonl`
2. **P10b — IMAP inbound polling** — email channel worker loop
3. **P10c — MCP health report** — `anvio mcp health`
4. **P10d — Prometheus metrics** — `GET /api/metrics`

## P10a — Usage CLI

```bash
anvio usage stats
anvio usage stats --json
anvio usage stats --last 24h
```

Reads `workspace/audit/tokens.jsonl` and aggregates by agent/channel with cost totals.

## P10b — IMAP

Configure in workspace channels or env:

```yaml
channels:
  email:
    enabled: true
    smtpHost: smtp.example.com
    imapHost: imap.example.com
    imapPort: 993
    pollIntervalMs: 60000
    username: bot@example.com
    password: ${EMAIL_PASSWORD}
```

Worker starts IMAP polling when `EMAIL_IMAP_HOST` is set.

## P10c — MCP health

```bash
anvio mcp health
```

Returns per-server transport, connected state, restart count, tool count.

## P10d — Prometheus

In-process `MetricsRegistry` updated on token audit. Exposed at:

```
GET /api/metrics
```

Counters: `anvio_tokens_input_total`, `anvio_tokens_output_total`, `anvio_tokens_total`, `anvio_token_cost_usd_total`

## Remaining (P11+)

- IMAP IDLE push instead of poll
- Grafana dashboard templates
- Credential pool usage.jsonl flush
- Routing audit.jsonl emit
