# Hermes + slaude Parity Audit

Gap register detail: [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md).

**Baseline:** v1.7.0 (Phase L6 — runtime learning + LLM skill evolution)

## Summary (v1.7.0)

| Area | Parity | Notes |
|------|--------|-------|
| **MD-first artifacts** | ✅ ~95% | Skills, souls, agents, workflows, personas `.md` |
| **Channel harness** | ✅ ~90% | Enabled by default; Mattermost + voice hooks (P2) |
| **SOUL.md + gate** | ✅ | Policy gate + contextual connections (P1) |
| **Learning loop** | ✅ ~85% | L6 runtime tool learning, LLM skill/session summarizer, FTS5, Honcho |
| **Tool gateway** | 🟡 ~35% | ~8 builtins + agent tool loop; vs Hermes 60+ |
| **MCP** | ✅ | Full bridge |
| **Multi-channel** | ✅ ~65% | ~13 types + Mattermost; Hermes 20+ |
| **Voice** | 🟡 ~55% | CLI + Telegram/Discord hooks; no streaming STT |
| **Remote runtimes** | 🟡 ~35% | Docker + ACP/Cursor; SSH/Daytona/Modal partial |
| **Desktop app** | ❌ | Deferred P3 |
| **Contextual connections** | ✅ ~90% | Broker + login-host (P1) |
| **Knowledge base** | ✅ | raw→wiki (slaude parity) |
| **Local-first / Agent OS** | 🔵 | Goals, kanban, batch — Anvio strength |

## Estimated overall parity

| Reference | v1.6.0 | v1.7.0 |
|-----------|--------|--------|
| Hermes Agent | ~72% | **~78%** |
| slaude | ~84% | **~86%** |

## Still missing vs Hermes

- 60+ bundled tools (image gen, TTS tool wired, Nous Portal)
- Native model `tool_use` API (Anvio uses fenced `anvio_tool` blocks)
- Scheduled LLM summarizer cron (session-end LLM ✅)
- Singularity, RL/Atropos trajectory export
- Desktop installer + tray
- Real-time streaming STT

## Still missing vs slaude

- Slack Agents API status surface
- Strict MCP-only output mode
- `slaude.json` manifest import
- Full CDP browser grant
- `/1on1` command parity

## Related

- [55-phase-l6-learning-priorities.md](./55-phase-l6-learning-priorities.md)
- [52-phase-k-priorities.md](./52-phase-k-priorities.md)

Terakhir diperbarui: v1.7.0 (2026-06-19).
