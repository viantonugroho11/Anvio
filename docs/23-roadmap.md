# Roadmap

## Phase 0 — Foundation ✅
Monorepo, docs, core packages

## Phase 1 — MVP ✅
Runtime, Anthropic, Web Chat, Redis+PG memory

## Phase 2
MCP, Qdrant, approval workflow, admin UI

## Phase 3
Multi-provider, Telegram/Discord, workflows

## Phase 4
Multi-agent orchestration, K8s

---

## Advanced Agent OS (2026) ✅

Cross-cutting initiative documented in [24-advanced-agent-os-overview.md](./24-advanced-agent-os-overview.md).

| Sub-Phase | Features | Units | Status |
|-----------|----------|-------|--------|
| **A — Foundation** | Workspace scaffold, Soul, Goals, Memory Providers | U1–U4 | ✅ |
| **B — Automation** | Cron, Automation Engine, Blueprints, Event Hooks | U5–U7, U12 | ✅ |
| **C — Coordination** | Delegation v2, Kanban, Worker Lanes, Batch | U8–U9, U13 | ✅ |
| **D — Execution** | Runtime Providers, Code Execution, ACP | U10–U11, U18 | ✅ |
| **E — Platform** | Credentials, Routing, Skills, Integrations | U14–U17 | ✅ |
| **F — Docs & CLI** | Documentation suite, CLI surface, workspace templates | U19 | ✅ |
| **G — Channel Harness** | Generalized slaude harness (all channels), Soul Gate, approval | U20–U28, U36 | ✅ |
| **H — Learning & Tools** | Hermes learning loop, Tool Gateway, Knowledge base | U29–U31, U37 | ✅ |
| **I — Scale & Reach** | Workflow engine, expanded channels, remote runtimes, voice | U32–U35, U38 | ✅ |
| **J — Docs & Polish** | MD-first artifacts, parity audit, product docs | U39 | ✅ |

## Phase K — Priority Pillars (active)

Focus: **Learning & memory**, **Automation & workflows**, **Authoring (J)**, **Tooling**, **Runtime**.

| Pillar | Key gaps closed | Doc |
|--------|-----------------|-----|
| Learning & memory | Summarizer, recall index, tool-use drafts | [52-phase-k-priorities.md](./52-phase-k-priorities.md) |
| Automation & workflows | PLAN→EXECUTE→REVIEW planner | [52-phase-k-priorities.md](./52-phase-k-priorities.md) |
| Authoring Phase J | Personas `.md`, hermes-tech import | [49-workspace-artifacts.md](./49-workspace-artifacts.md) |
| Tooling | file_read/write, sandbox execute_code | [44-tool-gateway.md](./44-tool-gateway.md) |
| Runtime | Docker first-class provider | [47-remote-runtimes.md](./47-remote-runtimes.md) |

Full plan (Phase G+): [plans/2026-06-19-002-feat-unified-agent-product-plan.md](./plans/2026-06-19-002-feat-unified-agent-product-plan.md).

### Documentation Index

| Doc | Topic |
|-----|-------|
| [24-advanced-agent-os-overview.md](./24-advanced-agent-os-overview.md) | Overview & CLI surface |
| [25-soul-system.md](./25-soul-system.md) | Soul identity engine |
| [26-goal-system.md](./26-goal-system.md) | Persistent goals |
| [27-automation-engine.md](./27-automation-engine.md) | Automation & cron |
| [28-kanban-system.md](./28-kanban-system.md) | Kanban & worker lanes |
| [29-memory-providers.md](./29-memory-providers.md) | Memory providers |
| [30-runtime-providers.md](./30-runtime-providers.md) | Runtimes & code execution |
| [31-event-hooks.md](./31-event-hooks.md) | Event hooks |
| [32-batch-processing.md](./32-batch-processing.md) | Batch engine |
| [33-credential-pools.md](./33-credential-pools.md) | Credential pools |
| [34-blueprint-catalog.md](./34-blueprint-catalog.md) | Blueprint catalog |
| [35-workspace-architecture.md](./35-workspace-architecture.md) | Workspace layout |
| [36-provider-routing.md](./36-provider-routing.md) | Provider routing |
| [37-skills-catalog.md](./37-skills-catalog.md) | Skills catalog |
| [38-integration-architecture.md](./38-integration-architecture.md) | MCP integrations |
| [39-editor-integration.md](./39-editor-integration.md) | ACP editor server |
| [40-subagent-delegation.md](./40-subagent-delegation.md) | Subagent delegation |
| [41-channel-harness.md](./41-channel-harness.md) | Channel harness |
| [42-soul-gate.md](./42-soul-gate.md) | Soul Gate / SOUL.md policy |
| [43-learning-loop.md](./43-learning-loop.md) | Learning loop |
| [44-tool-gateway.md](./44-tool-gateway.md) | Tool gateway |
| [45-workflow-engine.md](./45-workflow-engine.md) | Workflow DAG engine |
| [46-expanded-channels.md](./46-expanded-channels.md) | Expanded channels |
| [47-remote-runtimes.md](./47-remote-runtimes.md) | Remote runtimes |
| [48-voice-mode.md](./48-voice-mode.md) | Voice mode |
| [49-workspace-artifacts.md](./49-workspace-artifacts.md) | MD-first conventions |
| [50-hermes-slaude-parity.md](./50-hermes-slaude-parity.md) | Hermes + slaude gap audit |
| [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) | Gap register lengkap (prioritas P0–P3) |
| [52-phase-k-priorities.md](./52-phase-k-priorities.md) | Phase K — lima pilar prioritas |
