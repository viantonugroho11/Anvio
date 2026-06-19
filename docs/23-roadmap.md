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

## Advanced Agent OS (2026)

Cross-cutting initiative documented in [24-advanced-agent-os-overview.md](./24-advanced-agent-os-overview.md).

| Sub-Phase | Features | Units |
|-----------|----------|-------|
| **A — Foundation** | Workspace scaffold, Soul, Goals, Memory Providers | U1–U4 |
| **B — Automation** | Cron, Automation Engine, Blueprints, Event Hooks | U5–U7, U12 |
| **C — Coordination** | Delegation v2, Kanban, Worker Lanes, Batch | U8–U9, U13 |
| **D — Execution** | Runtime Providers, Code Execution, ACP | U10–U11, U18 |
| **E — Platform** | Credentials, Routing, Skills, Integrations | U14–U17 |

Full plan: [plans/2026-06-19-001-feat-advanced-agent-os-plan.md](./plans/2026-06-19-001-feat-advanced-agent-os-plan.md).

### Recommended First PR
Phase A (U1–U4): Soul + Goals + Memory refactor — proves Advanced OS foundation without automation complexity.

### Documentation
- [25-soul-system.md](./25-soul-system.md)
- [26-goal-system.md](./26-goal-system.md)
- [27-automation-engine.md](./27-automation-engine.md)
- [28-kanban-system.md](./28-kanban-system.md)
- [29-memory-providers.md](./29-memory-providers.md)
- [30-runtime-providers.md](./30-runtime-providers.md)
- [31-event-hooks.md](./31-event-hooks.md)
- [32-batch-processing.md](./32-batch-processing.md)
- [33-credential-pools.md](./33-credential-pools.md)
- [34-blueprint-catalog.md](./34-blueprint-catalog.md)
- [35-workspace-architecture.md](./35-workspace-architecture.md)
