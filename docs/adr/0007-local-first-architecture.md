# ADR 0007: Local-First File-First Architecture

## Status

Accepted

## Context

Initial implementation assumed enterprise patterns: mandatory PostgreSQL, JWT auth, NATS, Docker.

Modern agent systems (and user requirements) favor local-first operation.

## Decision

Adopt **Local-First, File-First, CLI-First** architecture:

- Default storage: filesystem (`workspace/`)
- Default auth: disabled (`@anvio/auth` optional plugin)
- Default memory: JSON files
- Default events: in-process (`LocalEventBus`)
- Primary interface: `apps/cli` (`anvio chat`)

PostgreSQL, Redis, NATS, OAuth remain available as Level 2–4 enhancements via `workspace/anvio.yaml`.

## Consequences

- Agents run immediately after `pnpm install && pnpm build`
- Workspace is portable (git, backup, move)
- API and gateway become optional layers
- `@anvio/db` package retained for Level 3 but not required

## Alternatives Rejected

- Mandatory PostgreSQL — blocks zero-config local usage
- JWT on by default — friction for solo developers
- API-first — CLI is the natural interface for agent systems
