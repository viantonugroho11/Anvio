# Channel Harness (Phase G)

Generalized **slaude-style harness** for all channels — not Slack-only.

## What It Does

| Capability | Description |
|------------|-------------|
| **Inbound gate** | Block users, enforce zone trust, engagement rules |
| **Soul Gate** | `SOUL.md` → `SoulPolicy` with id verification |
| **Output discipline** | Suppress raw assistant text; deliver via output port |
| **Approval gate** | Scope-based approver matching on summary text |
| **Format pipeline** | Markdown → Slack / Telegram / Discord / plain |
| **Simulation** | Test policies without live channel credentials |
| **Connect broker** | Per-user encrypted connections (opt-in) |

## Enable Harness

```yaml
# workspace/harness/defaults.yaml
spec:
  enabled: true
  soulSlug: architect-soul
  suppressRawOutput: true
```

Restart worker/API after enabling.

## SOUL.md Authoring

```markdown
## Identity
- Name: Architect Soul
- Role: Senior Software Architect

## Reporting

Manager / backup manager gate DMs and restricted zones (`dmPolicy: manager_only`).  
Approver user IDs are **channel-prefixed** so one SOUL works across Slack, Telegram, WhatsApp, etc.:

- `slack:U012ABC`
- `telegram:123456789`
- `whatsapp:15551234567`
- Manager: U_MANAGER01

## Allowed channels
- C0123456789

## Trusted channels
- C0AAATEAM00

## Blocked
- U0SPAMUSR00

## Approvers
- U_MANAGER01: anything ; catchall
- U_DBA01: database migrations, schema, SQL

## Mandate
- Help the team ship maintainable systems.
```

```bash
anvio soul import workspace/souls/architect-soul/SOUL.md --slug architect-soul
anvio soul validate-policy workspace/souls/architect-soul/SOUL.md
```

## CLI

```bash
anvio harness status
anvio harness simulate
anvio connect list|put|revoke|login-host
```

Set `ANVIO_CONNECTION_ENCRYPTION_KEY` when `connectBroker.enabled: true`.

## Architecture

```
Inbound → HarnessGateway → (policy + engagement) → Agent Runtime
Runtime → HarnessOutputPort → format + redact → ChannelAdapter
```

## Packages

| Package | Role |
|---------|------|
| `@anvio/harness` | Gateway, engagement, output, approval, format |
| `@anvio/soul-gate` | SOUL.md parser, policy cache, verifier |

## Related

- Plan: [2026-06-19-002-feat-unified-agent-product-plan.md](./plans/2026-06-19-002-feat-unified-agent-product-plan.md)
- Channels: [10-channels.md](./10-channels.md)
- Soul: [25-soul-system.md](./25-soul-system.md)
