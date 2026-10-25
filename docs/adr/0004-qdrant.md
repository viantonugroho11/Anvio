# ADR 0004: Qdrant for Semantic Memory

## Decision
Qdrant in Phase 2.

## Rationale
Self-hosted, performant, simple API vs pgvector.

## Reconciliation note (2026-10-25)

Status was not recorded; treated as **Accepted**, but **not implemented**. `memory.provider: qdrant` is accepted by the schema and resolves to a stub provider (`packages/memory/src/provider-factory.ts`). There is no semantic vector store. Tracked in [docs/ROADMAP.md](../ROADMAP.md). Original decision text above is unchanged.
