# ADR 0003: PostgreSQL + Drizzle

## Decision
PostgreSQL with Drizzle ORM.

## Rationale
ACID, JSONB for config, lightweight ORM.

## Reconciliation note (2026-10-25)

Status was not recorded; treated as **Accepted**. Drizzle/PostgreSQL lives in `packages/db`. Since [ADR-0007](0007-local-first-architecture.md) it is an optional Level 3+ component, not a requirement. Original decision text above is unchanged.
