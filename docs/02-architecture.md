# Architecture

Anvio follows a **Local-First, File-First, CLI-First** architecture.

## Priority Order

1. **CLI** — primary interface, fully operational alone
2. **API** — optional REST layer
3. **Web UI** — optional dashboard (Phase 2)

## Default Mode (Level 1)

- No authentication
- Filesystem storage (`workspace/`)
- Filesystem memory (`workspace/memory/`)
- In-process events (no NATS)
- No PostgreSQL, Redis, or Docker required

## Package Boundaries

```
apps/
  cli/        Primary entry point
  api/        Optional REST (NestJS composition root)
  worker/     Optional background consumer
  gateway/    Optional WebSocket

packages/
  core/         Schemas, ports
  workspace/    Workspace loader, session store
  storage/      Pluggable storage (filesystem default)
  auth/         Optional auth plugin (disabled by default)
  platform/     Composition factory (wires everything from anvio.yaml)
  agents/       Runtime engine + orchestration
  memory/       Pluggable memory providers (filesystem default)
  events/       Local bus + NATS (optional)
  souls/        Soul identity engine (Advanced OS)
  goals/        Persistent goal system (Advanced OS)
  automation/   Cron + automation engine (Advanced OS)
  blueprints/   Workflow template executor (Advanced OS)
  kanban/       Kanban + worker lanes (Advanced OS)
  runtimes/     Runtime providers (local, cursor, etc.)
  execution/    Code execution sandbox (Advanced OS)
  hooks/        Event hook dispatcher (Advanced OS)
  batch/        Batch processing engine (Advanced OS)
  credentials/  Credential pools (Advanced OS)
  models/       Provider routing & fallback (Advanced OS)
  skills/       Skills catalog & registry (Advanced OS)
  personas/     Persona profiles (bootstrap templates)
  integrations/ MCP-first integration registry
  acp/          Editor integration (ACP server)
```

## Dependency Rule

`apps → platform → packages → core`

Domain logic never lives in NestJS controllers.

## Progressive Enhancement

See README for Level 1–4 matrix.

## Authentication

Auth is an **optional plugin**. Default: `auth.enabled: false`.

OAuth/JWT only activated when external MCP providers require it (GitHub, Google, Slack).

Local tools (filesystem, browser, memory, sessions) work without authentication.

## Advanced Agent OS

See [24-advanced-agent-os-overview.md](./24-advanced-agent-os-overview.md) for the full feature map: Soul System, Goals, Automation, Kanban, Runtime Providers, and more.

Implementation plan: [plans/2026-06-19-001-feat-advanced-agent-os-plan.md](./plans/2026-06-19-001-feat-advanced-agent-os-plan.md).
