# Changelog

All notable changes to Anvio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.1.0] - 2026-06-19

**Advanced Agent OS** — long-lived identity, goals, automation, coordination, and pluggable execution on the local-first foundation.

### Added

#### Identity & memory
- **Soul System** (`@anvio/souls`) — persistent agent identity in `workspace/souls/`
- **Goal System** (`@anvio/goals`) — durable goals with progress tracking
- **MemoryProvider** port and factory — unified memory abstraction over filesystem (default)

#### Automation & workflows
- **Automation Engine** (`@anvio/automation`) — cron scheduler with filesystem state in `workspace/automations/`
- **Blueprint Catalog** (`@anvio/blueprints`) — DAG blueprint executor and template engine
- 8 built-in blueprints in `configs/blueprints/` (daily-summary, github-triage, security-audit, …)
- **Event Hooks** (`@anvio/hooks`) — script, webhook, and MCP hook handlers

#### Coordination
- **Kanban Engine** (`@anvio/kanban`) — task boards with worker lane routing
- **Batch Processing** (`@anvio/batch`) — scheduled batch jobs with filesystem progress store
- **Subagent Delegation v2** — task planner and delegation progress tracking in `@anvio/agents`

#### Execution
- **Runtime Providers** (`@anvio/runtimes`) — local, Claude Code, Codex, Cursor, external stub
- **Code Execution** (`@anvio/execution`) — sandboxed process executor with audit log
- **ACP Editor Integration** (`@anvio/acp`) — Agent Client Protocol server for editor attach

#### Core schemas & ports
- Schemas: soul, goal, automation, batch, blueprint, kanban, hook
- Ports: soul, goal, memory-provider, runtime-provider, code-execution, kanban, batch

#### CLI commands
- `anvio soul`, `anvio goal`, `anvio blueprint`, `anvio automation`, `anvio cron`
- `anvio hooks`, `anvio kanban`, `anvio batch`, `anvio runtime`, `anvio exec`, `anvio acp`

#### Workspace templates
- `workspace/souls/architect-soul.yaml`, `workspace/hooks/hooks.yaml`, `workspace/automations/daily-summary.yaml`

#### Documentation
- Advanced Agent OS overview (docs 24–40) and implementation plan
- Updated architecture and roadmap for Phase A–E

#### Tests
- Integration tests for Phase A/B, delegation, kanban, and batch

### Changed
- `createPlatform()` wires soul service, blueprint executor, automation engine, and hook engine
- Agent schema supports `spec.soul` alongside persona fallback
- Workspace schema extended for advanced OS configuration

[Unreleased]: https://github.com/viantonugroho11/Anvio/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/viantonugroho11/Anvio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/viantonugroho11/Anvio/releases/tag/v1.0.0

First stable release — **local-first, file-first, CLI-first** AI Agent Operating System.

### Added

#### Core platform
- Monorepo with pnpm workspaces and Turborepo (`apps/` + `packages/`)
- `@anvio/core` — Zod schemas, ports, and shared types
- `@anvio/platform` — `createPlatform()` composition factory wired from `anvio.yaml`
- `@anvio/workspace` — workspace loader, filesystem session store, artifact helpers
- Progressive enhancement Levels 1–4 (filesystem → SQLite → PostgreSQL → K8s)

#### Agent runtime
- `@anvio/agents` — `DefaultAgentRuntime` with persona, skills, and memory integration
- `@anvio/personas` and `@anvio/skills` — YAML-driven configuration loaders
- `@anvio/models` — Anthropic provider with mock fallback when no API key is set
- `@anvio/memory` — filesystem memory store (default); PostgreSQL/Redis optional (Level 3)
- `SupervisorOrchestrator` for multi-agent delegation patterns

#### CLI (primary interface)
- `anvio init`, `anvio agents list`, `anvio chat`, `anvio run`
- `anvio sessions`, `anvio status`, `anvio logs`
- `anvio approve`, `anvio stop`, `anvio inbox`
- `anvio worktree list|create|remove` — optional git worktree isolation per session
- One-command installer: `scripts/install.sh`

#### Channels
- `ChannelHub` with session bridge and filesystem inbox
- Built-in adapters: CLI, REST API, Web Chat
- External adapters: Telegram, Discord, Slack (Socket Mode), WhatsApp (webhook)
- Channel config in `workspace/anvio.yaml` (`spec.channels.*`)
- WhatsApp webhook controller at `/api/channels/whatsapp/webhook`

#### Apps (optional Level 2+)
- `apps/api` — NestJS REST API (auth optional)
- `apps/worker` — background agent run consumer with channel progress events
- `apps/gateway` — WebSocket gateway

#### Storage & auth
- Filesystem storage provider (default) — no database required
- Auth disabled by default (`NoAuthProvider`); optional JWT/OAuth plugin
- Portable `workspace/` directory — backup, git, move without migration

#### Events
- In-process `LocalEventBus` (default)
- NATS JetStream support (optional Level 3)

#### Documentation
- Architecture docs, ADRs (local-first, channel hub)
- Comprehensive README with Mermaid diagrams

#### CI
- GitHub Actions: lint, typecheck, test, build on `main` and PRs
- Release workflow — auto-publish GitHub Releases from `v*` tags using `CHANGELOG.md`

#### Channel health
- `anvio channels status [--json]` — probe credentials and connectivity without starting the worker
- Health states: `healthy`, `degraded`, `disabled`, `misconfigured`, `unreachable`

### Changed

- Architecture revised from enterprise/SaaS assumptions to local-first defaults
- Personas and skills moved from database to filesystem config loaders
- API no longer requires JWT authentication by default

### Security

- Runtime workspace data (`memory/`, `sessions/`, `inbox/`, `worktrees/`, `artifacts/`) excluded from git

---

## Release process

1. Update `[Unreleased]` section in this file with your changes
2. Move entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading
3. Commit, tag, and push:

   ```bash
   git tag -a v1.0.1 -m "Anvio v1.0.1"
   git push origin main --tags
   ```

4. GitHub Actions **Release** workflow validates the build and publishes a GitHub Release with notes extracted from this file.

[Unreleased]: https://github.com/viantonugroho11/Anvio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/viantonugroho11/Anvio/releases/tag/v1.0.0
