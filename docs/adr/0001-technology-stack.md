# ADR 0001: Technology Stack

## Decision
TypeScript, pnpm, Turborepo, NestJS, Next.js, PostgreSQL, Redis, NATS, Qdrant.

## Rationale
Ecosystem maturity, small team maintainability.

## Alternatives
Nx (heavier), npm (slower).

## Reconciliation note (2026-10-25)

Status was not recorded; treated as **Accepted**. TypeScript, pnpm, Turborepo, NestJS (`apps/api`) and Next.js (`apps/web`) are in use. PostgreSQL, Redis and NATS are optional Level 3+ components, as reframed by [ADR-0007](0007-local-first-architecture.md). Qdrant is not implemented: the `qdrant` memory provider is a stub (`packages/memory/src/provider-factory.ts`). See [ADR-0004](0004-qdrant.md). Original decision text above is unchanged.
