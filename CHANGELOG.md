# Changelog

All notable changes to Anvio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.13.0] - 2026-06-19

**Phase P8 — MCP stdio, channel E2E, LLM SoulPolicy**

### Added
- `McpStdioClient` with stdio transport (`transport: stdio|stub` in mcp/servers.yaml)
- Teams Bot Framework webhook + outbound; Matrix room webhook; Email inbound/outbound queue
- API routes: `POST /api/channels/teams/webhook`, `POST /api/channels/matrix/webhook`
- LLM `extractSoulPolicy` from SOUL.md with regex fallback and id verification
- Harness profiles for teams, matrix, email channels

### Docs
- [61-phase-p8-priorities.md](./docs/61-phase-p8-priorities.md)

---

## [1.12.0] - 2026-06-19

**Phase P7 — Gemini native tools + MCP agent runtime**

### Added
- Gemini provider: native `functionCall` / `functionResponse` with `supportsNativeTools`
- `McpToolPort` exposes enabled MCP servers to agent runtime as `anvio_mcp__{server}__{tool}`
- `McpFirstCallGate` — first MCP tool use per session requires approval (`firstCallApproval` in mcp config)
- Worker persists `mcpApprovedTools` on approval and resumes agent runs

### Docs
- [60-phase-p7-priorities.md](./docs/60-phase-p7-priorities.md)

---

## [1.11.0] - 2026-06-19

**Phase P6 — OpenAI native tools, memory recall, strict harness, CI fixes**

### Added
- OpenAI-compatible providers: native `tool_use` / `tool_calls` streaming (`supportsNativeTools`)
- Built-in `anvio_tools__memory_recall` wired to memory provider search (FTS5 / keyword index)
- Strict harness: messaging channels no longer fall back to raw assistant dump; require `anvio_channel__reply`
- Harness reply tracking (`resetReplyTracking`, `hasDeliveredReply`)

### Fixed
- Export `ChannelHealthReport` from `@anvio/core` (CI `@anvio/channels` build)
- Type-safe `summarizeChannelHealth` exhaustive switch
- Slack block-action payload typing for approver `user.id`

### Docs
- [59-phase-p6-priorities.md](./docs/59-phase-p6-priorities.md)

---

## [1.10.0] - 2026-06-19

**Phase P5 — Multi-channel harness approval loop**

### Added
- End-to-end approval: agent `anvio_channel__request_approval` → pause → resume on any channel
- `HarnessAwareToolPort` merges built-in tools + channel tools when harness enabled
- Approver IDs with channel prefix (`slack:`, `telegram:`, `whatsapp:`, …)
- `approvalTimeoutSeconds` enforced in `ApprovalGate`
- Worker publishes `APPROVAL_REQUESTED`; resume via checkpoint after `APPROVAL_DECIDED`
- Interactive approve/reject with approver auth on Slack, Telegram, WhatsApp, Discord, Mattermost

### Docs
- [58-phase-p5-harness-approval.md](./docs/58-phase-p5-harness-approval.md)

---

## [1.9.0] - 2026-06-19

**Phase P4 — Native tool_use & expanded gateway**

### Added
- Anthropic native `tool_use` API in agent runtime (`supportsNativeTools`)
- `ModelToolDefinition`, `ModelToolCall`, `getModelToolDefinitions()` on tool gateway
- Tools: `glob_files`, `grep_search`, `execute_code_pipeline` (T1/T5)
- `anvio kb import-manifest` — workspace manifest import (replaces slaude naming)
- Example `configs/examples/workspace-manifest.json`

### Changed
- Removed slaude branding from docs; Hermes-focused parity narrative
- `import-slaude` CLI kept as deprecated alias

### Docs
- [57-phase-p4-priorities.md](./docs/57-phase-p4-priorities.md)

---

## [1.8.0] - 2026-06-19

**Phase P3 — Media tools, slaude import, scheduled learning**

### Added
- `anvio_tools__image_generate` — OpenAI DALL-E 3, saves to `artifacts/images/`
- `anvio_tools__text_to_speech` — OpenAI TTS via `@anvio/voice`
- `anvio kb import-slaude` — import `slaude.json` knowledge + skills (S6)
- `anvio learning summarize-sessions` — batch session LLM/rule summarization
- Automation action type `learning.summarize_sessions` for cron
- Bundled automation `session-memory-summarize.yaml` (every 6h, disabled by default)
- Example manifest `configs/examples/slaude.json`

### Docs
- [56-phase-p3-priorities.md](./docs/56-phase-p3-priorities.md)
- Gap register: T3, T4, S6, L5 cron ✅

---

## [1.7.0] - 2026-06-19

**Phase L6 — Runtime learning & LLM skill evolution**

### Added
- Agent runtime **tool loop** (multi-turn, fenced `anvio_tool` blocks, max 5 iterations)
- `ToolGateway.setOnToolCompleted()` hook for runtime learning
- `LearningEngine.onToolUseCompleted()` — Hermes-style skill patch on tool success
- **LLM summarizer** for skill evolution (`SkillEvolutionSummarizer`) with `shouldCreate` gate
- LLM session summarizer when model provider configured (Anthropic preferred)
- `RuntimeToolPort` in `@anvio/core`
- Tool call parser, tool instruction renderer in `@anvio/tools`
- `publishAgentRunCompleted` / `finalizeAgentRun` in `@anvio/platform`
- Integration tests: Phase L6 runtime learning
- Unit tests: skill evolution summarizer, tool call parser

### Changed
- `anvio chat` and inline `anvio run` emit `AGENT_RUN_COMPLETED` (learning on CLI paths)
- Platform wires `ToolGateway` into `DefaultAgentRuntime` and learning model provider
- Auto-promote runtime skills when `soul.spec.evolution.requireApproval: false`
- Gap register updated: L5 session LLM ✅, L6 runtime self-improve ✅

### Docs
- [55-phase-l6-learning-priorities.md](./docs/55-phase-l6-learning-priorities.md)
- Updated [43-learning-loop.md](./docs/43-learning-loop.md), [50-hermes-slaude-parity.md](./docs/50-hermes-slaude-parity.md), [51-gap-hermes-slaude.md](./docs/51-gap-hermes-slaude.md)

---

## [1.6.0] - 2026-06-19

**Phase P2 — Voice on channels & Mattermost (desktop deferred)**

### Added
- Mattermost channel adapter with WebSocket `posted` events and REST posts
- Telegram voice note transcription hook (Whisper via `@anvio/voice`)
- Discord audio attachment transcription hook
- `VoicePipeline.transcribeBuffer()` and channel voice helpers
- Channel health probe for Mattermost
- Harness profile for Mattermost

### Changed
- Enable channel voice via `spec.channels.voice.enabled` or `ANVIO_CHANNEL_VOICE=1`
- Workspace schema adds `channels.mattermost`

---

## [1.5.0] - 2026-06-19

**Phase P1 — Channel harness depth & contextual connections**

### Added
- Connection broker: per-user isolation, thread grants, list/revoke APIs
- OAuth login-host callback capture (`startLoginHost`)
- CLI: `anvio connect list|put|revoke|login-host`
- Multi-channel harness regression tests (telegram, discord, web-chat)
- Connection isolation integration tests

### Changed
- Harness enabled by default in workspace (`enabled: true`)
- Connect broker enabled by default (requires `ANVIO_CONNECTION_ENCRYPTION_KEY`)

---

## [1.4.0] - 2026-06-19

**Phase K+ — Memory search, browser sandbox, ACP production path**

### Added

#### Learning & memory
- FTS5 recall layer via optional `better-sqlite3` (`memory.fts: true` in workspace)
- Honcho dialectic context merged into `getContext` when API key configured

#### Tooling
- `browser` built-in tool with Playwright sandbox (falls back to `web_fetch` when Playwright absent)
- Optional `playwright` dependency on `@anvio/tools`

#### Runtime & editor integration
- ACP `POST /prompt/stream` SSE endpoint for streaming agent responses
- `CursorRuntimeProvider` delegates to local ACP server (`anvio acp serve`)
- CLI ACP server reuses sessions and streams via `platform.runtime.stream`

### Changed
- Platform passes `memory.fts` to memory provider factory
- Fixed `getBySession` to skip recall index JSON (non-array entries)

---

## [1.3.0] - 2026-06-19

**Phase K — Priority pillars:** Learning & memory, Automation & workflows, Authoring (Phase J), Tooling, Runtime.

### Added

#### Learning & memory
- Session summarizer stores compact summaries on session end
- Filesystem cross-session recall index (keyword-based)
- `LearningEngine.proposeFromToolUse()` for runtime skill drafts

#### Automation & workflows
- `PlanExecuteReviewEngine` — PLAN → EXECUTE → REVIEW planner
- `configs/planner/plan-execute-review.yaml`

#### Authoring & workspace (Phase J)
- `parsePersonaMd()` — personas load from `personas/*.md`
- Example `workspace/personas/architect.md`
- `scripts/import-hermes-skills.sh` for hermes-tech skill import

#### Tooling & execution
- Built-in `file_read` and `file_write` tools
- `execute_code` routes through audited `CodeExecutor` when wired from platform

#### Runtime
- Docker sandbox in `@anvio/execution`
- First-class `DockerRuntimeProvider` in `@anvio/runtimes`

#### Documentation
- [52-phase-k-priorities.md](docs/52-phase-k-priorities.md) — five-pillar priority stack
- Updated gap register and roadmap for Phase K focus

### Changed
- `FilesystemMemoryProvider` injects recall hits into memory context
- Platform wires `createCodeExecutor` into `ToolGateway`

---

## [1.2.0] - 2026-06-19

**Platform layer & multi-model** — credential pools, provider routing, skills catalog, MCP integrations, and 18 model providers.

### Added

#### Platform (Phase E)
- **Credential Pools** (`@anvio/credentials`) — AES-256-GCM encrypted store with round-robin and failover
- **Provider Routing** (`@anvio/models`) — task classifier, fallback chain, and `routing.yaml` router
- **Skills Catalog** (`@anvio/skills`) — bundled + workspace override resolver and installer
- **Integration Framework** (`@anvio/integrations`) — MCP registry, bridge, and blueprint `mcp` step wiring
- 9 additional bundled skills in `configs/skills/`

#### Multi-model providers
- OpenAI-compatible drivers: OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Together, xAI, Fireworks, Moonshot, Cerebras, SambaNova, Perplexity, Cohere, Hugging Face, Ollama
- Gemini provider via Google Generative AI API
- `ModelProviderRegistry` — agents resolve provider from `spec.model.provider`
- `custom` provider for arbitrary OpenAI-compatible endpoints (`baseUrl` + `apiKeyEnv`)

#### CLI & workspace (U19)
- `anvio credentials`, `anvio routing`, `anvio skill`, `anvio mcp`, `anvio workspace validate`
- `anvio routing catalog|providers` — list supported and configured providers
- Workspace init scaffolds `providers/routing.yaml`, `mcp/servers.yaml`, `hooks/hooks.yaml`

#### Core schemas
- `credential`, `routing`, `mcp`, `model-provider` schemas and credential port

#### Tests
- Integration tests for credentials, routing, skills catalog, and MCP integrations

### Changed
- `DefaultAgentRuntime` uses per-agent model provider from registry
- `createPlatform()` registers all configured providers from environment
- Documentation and roadmap mark Advanced Agent OS Phases A–F complete

---

## [1.1.0] - 2026-06-19

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

---

## [1.0.0] - 2026-06-19

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

[Unreleased]: https://github.com/viantonugroho11/Anvio/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/viantonugroho11/Anvio/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/viantonugroho11/Anvio/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/viantonugroho11/Anvio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/viantonugroho11/Anvio/releases/tag/v1.0.0
