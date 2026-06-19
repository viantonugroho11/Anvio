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
  core/       Schemas, ports
  workspace/  Workspace loader, session store
  storage/    Pluggable storage (filesystem default)
  auth/       Optional auth plugin (disabled by default)
  platform/   Composition factory (wires everything from anvio.yaml)
  agents/     Runtime engine
  memory/     Pluggable memory (filesystem default)
  events/     Local bus + NATS (optional)
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
