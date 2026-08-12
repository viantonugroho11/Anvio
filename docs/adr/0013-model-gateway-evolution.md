# ADR-0013: Model Gateway — evolve `packages/models` instead of greenfield rewrite

## Status

Proposed — Phase-1 increments accepted; Phase-2 target deferred to Epic 0 kernel scaffolding.

## Context

The vNext plan (Epic 12 F1/F2 in `docs/engineering-backlog-vnext.md`) calls for a new `packages/model-gateway/` that owns the canonical model contract, adapters, router, fallback chain, spend metering, and credential pools. Today, `packages/models` already implements most of that surface:

| Epic 12 concern | Current implementation |
|---|---|
| Canonical request/response | `ChatRequest`, `ChatResponse`, `StreamChunk`, `TokenUsage` in `@anvio/core/schemas` |
| Adapters | `anthropic.provider.ts`, `openai-compatible.provider.ts`, `gemini.provider.ts` — 18-provider coverage via `OPENAI_COMPATIBLE_PROVIDER_SPECS` |
| Provider registry | `ModelProviderRegistry` + `createModelProviderRegistryFromEnv` |
| Router + task classifier | `ModelRouter`, `classifyTask`, `strategyForRoute` |
| Fallback chain | `walkFallbackChain` |
| Metering | Per-call tokens + latency via `withCallMetrics` / `recordStreamMetrics` (shipped alongside this ADR) |
| Prompt caching | Anthropic `cache_control` — ADR-0010 Layer 2 |
| Credential pools | `packages/credentials` (encrypted per-tenant/per-agent) |

Greenfielding a new package would duplicate ~2 000 LOC of working, tested code and force a shim (E12.F2.S5 in the backlog). Evolve-first: keep `packages/models` as the gateway and close named gaps with named PRs.

## Decision

`packages/models` **is** the Model Gateway. Retire the "new package required" framing in the backlog. Track Epic 12 F1/F2 as capability gaps against the current package:

### D1 — Named gaps, tracked as follow-up stories

| Gap | Story | Effort | Status |
|-----|-------|--------|--------|
| Per-call token+latency+cache metrics | E12.F2.S3 slice | S | ✅ shipped v1.26.0 (`withCallMetrics`, `recordStreamMetrics`) |
| `AbortSignal` propagation to every adapter's HTTP/SDK call | E12.F1.S5 | S | ⏳ pending |
| `ModelDescriptor` registry (window, caps, cost per model) | E12.F1.S1 | M | ⏳ partial via `MODEL_COST_PER_1M` in platform |
| Circuit breaker per provider (health-aware skip) | E12.F2.S2 | M | ⏳ pending — only fallback chain today |
| Hard spend limit + typed error | E12.F2.S3 remainder | S | ⏳ pending — audit only, no enforcement |
| `gateway.model: legacy \| vnext` shim | E12.F2.S5 | — | ❌ not needed — `packages/models` IS vnext |

### D2 — Do not create `packages/model-gateway/`

Naming it "gateway" adds indirection without capability. `packages/models` is the boundary the rest of the system already imports; renaming or duplicating it would ripple through every `@anvio/models` import in `packages/agents`, `packages/platform`, `apps/cli` for zero user-visible value.

### D3 — Kernel scaffolding (Epic 0) still applies

When `packages/{contracts,substrate,telemetry,testing}` land in Phase 2, extract the canonical `ChatRequest`/`ChatResponse` into `packages/contracts` and re-export from `@anvio/models` for backward compatibility. Do NOT block Phase-1 metering/router work on Phase-2 kernel work — the extraction is a mechanical move, not a semantic change.

## Consequences

**Positive**

- Zero-ripple: no consumer of `@anvio/models` needs to change import paths.
- Every capability gap becomes a single-file PR against a working baseline instead of a greenfield rewrite.
- Fallback + routing behavior — the piece with the most integration-test coverage — stays untouched.

**Negative**

- `docs/engineering-backlog-vnext.md` Epic 12 phrasing (§93–113) reads as "new package" and must be re-labelled to "evolve `packages/models`". Follow-up doc PR.
- If Epic 0 substrate lands with its own contracts layer, the extraction becomes a separate story — flagged in D3.

## Cross-references

- ADR-0010: token optimization layers (prompt caching = Layer 2, tool clip = Layer 3)
- ADR-0011: model provider auth (D3 `routing.yaml` = router config surface today)
- ADR-0012: zod 4 migration deferred (blocks canonical-contract refactor if we ever move schemas into a new package)
