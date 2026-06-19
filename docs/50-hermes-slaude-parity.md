# Hermes + slaude Parity Audit (Phase J)

Honest gap analysis after sub-phases A–I. Target references:

- [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs)
- [slaude](https://github.com/barockok/slaude)
- [hermes-tech](https://github.com/viantonugroho11/hermes-tech) (your engineering platform)

## Summary

| Area | Merged? | Notes |
|------|---------|-------|
| **MD-first artifacts** | ✅ Phase J | Skills, souls, agents, workflows → `.md`; YAML legacy still loads |
| **Channel harness** | ✅ ~85% | All channels stack; slaude depth on Slack/Telegram/Discord; Teams/Matrix in-memory |
| **SOUL.md + gate** | ✅ | `soul-gate` policy parser + `souls/*/SOUL.md` identity |
| **Learning loop** | ✅ ~70% | Skill drafts + memory nudge + Honcho delegate; no FTS5/sqlite recall yet |
| **Tool gateway** | ⚠️ ~25% | 3 builtins vs Hermes 60+; no Nous Portal bundle |
| **MCP** | ✅ | Full bridge; slaude parity |
| **Cron / automation** | ✅ | Hermes-like schedules + blueprints |
| **Workflows** | ✅ | DAG engine + blueprint step; Hermes workflows→skills pattern supported via skills |
| **Multi-channel** | ⚠️ ~50% | 12 types registered; Hermes claims 20+ (Mattermost, DingTalk, … not yet) |
| **Voice** | ⚠️ ~40% | CLI STT/TTS stub/API; no Telegram voice note / Discord VC |
| **Remote runtimes** | ⚠️ ~30% | SSH test + Daytona/Modal stubs; no Singularity |
| **Desktop app** | ❌ | U38 deferred |
| **Contextual connections** | ⚠️ ~60% | Broker scaffold; login-host/CDP deferred |
| **Simulation gateway** | ✅ | Harness simulate scenarios |
| **Knowledge base** | ✅ slaude | raw→wiki ingest |
| **Local-first** | ✅ Anvio strength | File workspace primary vs Hermes cloud/VPS focus |

## Hermes features not yet in Anvio

- 60+ bundled tools (browser sandbox, image gen, full execute_code pipeline)
- Nous Portal OAuth one-click setup
- Singularity runtime backend
- 20+ messaging platforms (Mattermost, Feishu, SMS, …)
- RL / Atropos trajectory export
- Desktop installer + tray
- FTS5 + LLM summarization memory layer (Hermes closed loop depth)

## slaude features not yet in Anvio

- Slack-only CDP login-host for contextual connections
- Full engagement profile tuning per Slack workspace nuance
- slaude.json manifest import (optional path documented, not default)

## hermes-tech patterns now supported

| hermes-tech | Anvio equivalent |
|-------------|------------------|
| `SOUL.md` | `souls/<slug>/SOUL.md` |
| `skills/*.md` | `skills/*.md` + `/skill-name` via agent binding |
| `profiles/` multi-agent | `agents/*.md` + personas + delegation |
| `workflows/` | `workflows/*.md` + `blueprints/` |
| `configs/planner.yaml` | `automations/` + blueprint PLAN→REVIEW |
| Cursor delegate | `runtime: cursor` + ACP (stub) |

## Recommendation

1. **Author in Markdown** — use workspace examples as templates (Phase J).
2. **Enable harness** when testing channels: `workspace/harness/defaults.yaml` → `enabled: true`.
3. **Next gaps to close** (post-J): tool gateway expansion, contextual connections CDP, voice on Telegram, Mattermost adapter.
