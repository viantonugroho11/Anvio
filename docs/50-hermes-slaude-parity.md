# Hermes + slaude Parity Audit

Gap register detail: [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md).

**Baseline:** v1.16.0 (Phase P11a — 21 gateway tools, OTel, planner CLI)

Full Hermes tool inventory: [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md)

## Summary (v1.16.0)

| Area | Parity | Notes |
|------|--------|-------|
| **MD-first artifacts** | ✅ ~95% | Skills, souls, agents, workflows, personas `.md` |
| **Channel harness** | ✅ ~92% | Enabled by default; multi-channel approval (P5+) |
| **SOUL.md + gate** | ✅ ~95% | Regex + LLM policy extraction (P8), contextual connections (P1) |
| **Learning loop** | ✅ ~90% | L6 runtime learning, LLM summarizer, FTS5, Honcho, skill evolution |
| **Tool gateway** | 🟡 ~55% | 21 builtins + MCP; Hermes ~71 — see [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md) |
| **MCP** | ✅ ~90% | Stdio client, first-call approval, health report (P7–P10) |
| **Native tool_use** | ✅ | Anthropic, OpenAI, Gemini (P4–P7) |
| **Multi-channel** | ✅ ~80% | ~13 types; Teams/Matrix/Email E2E (P8–P10) |
| **Voice** | 🟡 ~60% | CLI + Telegram/Discord hooks; no streaming STT |
| **Remote runtimes** | 🟡 ~35% | Docker + ACP/Cursor; SSH/Daytona/Modal partial |
| **Observability** | 🟡 ~70% | Token audit, Prometheus, OTel spans in worker/API (P9–P11a) |
| **Desktop app** | ❌ | Deferred |
| **Contextual connections** | ✅ ~90% | Broker + login-host (P1) |
| **Knowledge base** | ✅ | raw→wiki + `import-manifest` (slaude parity) |
| **Local-first / Agent OS** | 🔵 | Goals, kanban, batch — Anvio strength |

## Estimated overall parity

| Reference | v1.8.0 | v1.16.0 |
|-----------|--------|---------|
| Hermes Agent | ~80% | **~88%** |
| slaude | ~88% | **~92%** |

## Still missing vs Hermes

- ~71 Hermes built-in tools — mapping per tool: [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md)
- Nous Portal OAuth (T6)
- Desktop installer + tray (R8)
- Real-time streaming STT (V4)
- Trajectory export / Atropos RL (O1–O2)
- Remote runtimes: SSH agent exec, Daytona, Modal production (R3–R5)
- Signal live, Google Chat service account (C7–C8)
- Langfuse dashboard templates (OTel wired ✅)

## Still missing vs slaude

- Slack Agents API status surface
- Strict global MCP-only output mode (harness suppresses raw output per channel ✅)
- Full CDP browser grant (login-host OAuth ✅)
- `/1on1` command parity

## Closed since v1.8.0

- Native `tool_use` for OpenAI + Gemini (was Anthropic-only)
- MCP in agent runtime + stdio transport + reconnect
- Teams/Matrix webhooks, Email SMTP + IMAP poll
- LLM SoulPolicy extraction from SOUL.md
- Token usage audit + CLI + Prometheus metrics
- `slaude.json` → `anvio kb import-manifest` (P3)

## Related

- [63-phase-p10-priorities.md](./63-phase-p10-priorities.md) — Phase P10
- [61-phase-p8-priorities.md](./61-phase-p8-priorities.md) — Phase P8
- [55-phase-l6-learning-priorities.md](./55-phase-l6-learning-priorities.md) — Phase L6
- [52-phase-k-priorities.md](./52-phase-k-priorities.md)

Terakhir diperbarui: v1.15.0 (2026-06-19).
