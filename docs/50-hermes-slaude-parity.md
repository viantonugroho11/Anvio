# Hermes + slaude Parity Audit

Gap register detail: [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md).

**Baseline:** v1.17.0 (Phase P11 — 71 gateway tools, OTel, planner, MoA, HA)

Full Hermes tool inventory: [65-hermes-tools-catalog.md](./65-hermes-tools-catalog.md)  
**Gap tersisa:** [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md)

## Summary (v1.17.0)

| Area | Parity | Notes |
|------|--------|-------|
| **MD-first artifacts** | ✅ ~95% | Skills, souls, agents, workflows, personas `.md` |
| **Channel harness** | ✅ ~92% | Enabled by default; multi-channel approval |
| **SOUL.md + gate** | ✅ ~95% | Regex + LLM policy extraction (P8) |
| **Learning loop** | ✅ ~90% | L6 runtime learning, LLM summarizer, FTS5, Honcho |
| **Tool gateway** | ✅ ~95% breadth | **71 builtins**; sub-tools via MCP — [65](./65-hermes-tools-catalog.md) |
| **MCP** | ✅ ~90% | Stdio, first-call approval, health, presets (P11d) |
| **Native tool_use** | ✅ | Anthropic, OpenAI, Gemini |
| **Multi-channel** | ✅ ~80% | ~13 types; Teams/Matrix/Email E2E |
| **Voice** | 🟡 ~60% | CLI + hooks; no streaming STT |
| **Remote runtimes** | 🟡 ~35% | Docker + ACP/Cursor; SSH/Daytona partial |
| **Observability** | 🟡 ~75% | Token audit, Prometheus, OTel spans |
| **Desktop app** | ❌ | Deferred |
| **Local-first / Agent OS** | 🔵 | Goals, kanban, batch — Anvio strength |

## Estimated overall parity

| Reference | v1.17.0 |
|-----------|---------|
| Hermes Agent | **~93%** |
| slaude | **~94%** |

## Still missing (detail)

See **[69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md)** — P12 MCP E2E, channels, slaude polish, remote runtimes, streaming STT, research tooling.

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

Terakhir diperbarui: v1.17.0 (2026-06-19).
