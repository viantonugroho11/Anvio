# Architecture Evolution Review & Ledger

**Status:** Living document — update on every architectural change.
**Date:** 2026-07-13
**Doctrine:** Evolutionary architecture. The current repository IS the product. Strangler fig only where replacement is proven necessary. Related: [engineering-backlog-vnext.md](engineering-backlog-vnext.md) (story IDs referenced below), [architecture-review-vnext.md](architecture-review-vnext.md) (findings), ADR series in `docs/adr/`.

**Success metric:** value preserved, diffs minimized, maintainability/testability/token-efficiency improved — not code replaced.

---

## Module Reviews

Template fields condensed; every module follows Current State → Gap → Decision → Evolution Strategy → Migration → DoD. Decisions use exactly one of KEEP / KEEP+EXTEND / REFACTOR / REPLACE / REMOVE.

### M1 — Agent Runtime (`packages/agents`)

**Current State.** Responsibilities: multi-turn model↔tool loop, prompt assembly (persona+skills+soul), approval checkpoint/resume, streaming. Interfaces: `AgentRuntime` (`run`/`stream`/`resume`), `AgentRuntimeDeps`. Deps: core, models, tools, skills, personas, souls. Strengths: approval checkpoints, dual tool paths (native/fenced), provider-agnostic. Weaknesses (pre-EVO-001): 409-LOC untested generator; duplicated tool-round handling; approval helpers inline.

**Gap.** Zero tests (worst risk × complexity in repo); no abort propagation into provider HTTP; per-turn skill catalog rescan; silent catches; 5-iteration ceiling undocumented.

**Decision: REFACTOR** (extract, don't rewrite). Loop semantics are proven in production; only structure blocked testing.

**Evolution Strategy.** Extract class/module, preserve exports: loop → `runtime-loop.ts`, tool-round unification → `tool-executor.ts`, approval helpers → `approval-node.ts`. `DefaultAgentRuntime` keeps public API; `index.ts` untouched. Behavior quirks preserved deliberately (native-mode zero-calls falls through to fenced parsing).

**Migration.** Done in one PR-sized change (net −102 lines). Rollback: revert commit — no schema/config change. Compatibility: byte-identical export surface. Testing: 8 new loop tests (completion, tool round, approval suspend + checkpoint shape, stop, error, fallthrough).

**DoD.** ✅ builds, ✅ full suite green, ✅ no public API change, ✅ previously-untested critical path covered. Remaining (separate evolutions): abort signal (E12.F1.S5 analog on v1), skill-trigger cache (P1.S8), loop tests for prompt assembly path (P1.S7 remainder).

### M2 — Model Providers (`packages/models`)

**Current State.** 18-provider registry, route classifier, fallback chain, 3 adapter families (Anthropic, OpenAI-compatible, Gemini). Strengths: genuinely swappable, tested message mapping, route hints from skills. Weaknesses (pre-EVO-002): no prompt caching; usage ignored cache fields; no abort; no per-call cost metering.

**Decision: KEEP + EXTEND.** Best subsystem in repo; extensions only.

**Evolution Strategy.** Additive: cache breakpoints via exported pure helpers (`toAnthropicSystem`/`toAnthropicTools`), `promptCache` option (default on, off = old wire format), optional `TokenUsage.cacheReadTokens`/`cacheCreationTokens`. No adapter restructure.

**Migration.** Done (EVO-002). Rollback: `promptCache: false` or revert. Next extensions: cost metering per call (P1.S3), AbortSignal param (additive), OpenAI/Gemini cache semantics where supported.

**DoD.** ✅ 6 helper tests, ✅ additive types only, ✅ old shape preserved when disabled. Token impact: stable prefix (system+tools) billed at 10% on hits; expected 40–70% blended input-cost cut on multi-turn sessions.

### M3 — Memory (`packages/memory`)

**Current State.** `MemoryStore` port; filesystem impl: full message array per session JSON, long-term = append-only per-user JSON array mirroring raw turns, keyword recall index (500 entries). Redis/PG stubs gated to Level 2+. Strengths: correct port abstraction; tier gating. Weaknesses: unbounded short-term (token waste driver #1), `getBySession` scans all users, raw-turn mirroring adds cost without recall value, whole-file rewrite races.

**Decision: KEEP + EXTEND.** Port is right; implementations evolve behind it. No storage replacement (per doctrine: layered memory over storage swap).

**Evolution Strategy.** Inside existing `FilesystemMemoryStore`: (1) sliding window + summarize-on-overflow in `storeConversation` (P1.S4, ADR-0010 L1) — config `memory.maxShortTermMessages`, 0 = today's behavior; (2) stop mirroring raw turns — long-term writes become distilled entries from learning loop only; (3) session-indexed long-term reads; (4) recency decay + type weight in recall scoring. Lanes (episodic/semantic) arrive later as *types on existing entries*, not new stores (E3 stories).

**Migration.** Each step flag-guarded; summaries additive (raw session JSONL untouched — it's the source of truth). Rollback per flag. Risk: summary quality — mitigated by long-session eval fixture before default-on.

**DoD.** Window bounded; goldens unaffected below window; recall precision measured before/after; no new packages.

### M4 — Tools (`packages/tools`)

**Current State.** `ToolGateway` YAML enable-flags, 73 builtins, fenced-call parser, instructions/schema rendering. Strengths: breadth, single gateway choke point, dangerous tools default-off. Weaknesses: boolean-only policy; unbounded outputs; all schemas every turn; `mergeContext` mutable shared ctx; no audit/metrics per tool.

**Decision: KEEP + EXTEND.** Gateway is the right seam; extend spec, don't rebuild bus yet (vNext Tool Bus strangles it later — E5).

**Evolution Strategy.** (1) Output clipping + artifact offload wrapped around `ToolGateway.call` (P1.S5) — no builtin changes; (2) per-tool policy object as *optional* YAML extension (`timeoutMs`, `outputBudgetBytes`, `approval`) — boolean form keeps parsing (backward compatible), converter later; (3) per-tool latency/error metrics via existing `onToolCompleted` hook — hook already exists, just attach.

**Migration.** Additive YAML schema (zod `.optional()`); old files parse unchanged. Rollback: omit new keys. Fix `mergeContext` by freezing ctx at call time — small diff, behavior-equivalent for current callers.

**DoD.** No tool result exceeds budget; existing tool spec tests untouched and green; metrics visible.

### M5 — Knowledge (`packages/knowledge`)

**Current State.** `KnowledgeBaseStore` (raw/wiki dirs, YAML manifest), `KnowledgeIngestEngine` = file copy with header; `sync()` re-processes everything. Strengths: honest scoping, clean store abstraction, manifest pattern. Weaknesses: no change detection, no chunking/retrieval, "wiki synthesis" is a placeholder.

**Decision: KEEP + EXTEND.** 130 LOC total — nothing to replace; every improvement is additive on existing store/manifest. Rebuild explicitly rejected per doctrine.

**Evolution Strategy.** (1) Hash-based incremental sync: add `sha256` per raw file to existing manifest entries; `ingest()` skips unchanged (E4.F1.S3 scaled down — ~30-line diff); (2) real LLM synthesis behind the existing `ingest()` signature when a model provider is passed (optional dep, current copy behavior = fallback); (3) retrieval starts as FTS over wiki files reusing the memory FTS approach — no vector dependency at Level 1.

**Migration.** Manifest gains optional `hash` field — old manifests upgrade on first sync. Rollback: ignore hash (full reprocess = today). Risk: none material.

**DoD.** Second sync of unchanged corpus processes 0 files (test); manifest backward compatible.

### M6 — Prompt Assembly (in `packages/agents` + `personas`/`skills`)

**Current State.** Markdown-first artifacts; `assembleSystemPrompt` concatenates persona/skills/soul with `---` separators. Strengths: Markdown-first is a product feature; assembly is already isolated in one private method. Weaknesses: no version trail, no budget, no manifest.

**Decision: KEEP + EXTEND.** Explicitly per doctrine: registry/versioning/cache *without replacing prompt loading*.

**Evolution Strategy.** (1) Prompt hash: sha256 the assembled system prompt, record in session metadata (P1-adjacent, ~20-line diff) — instant reproducibility trail; (2) segment token counts logged alongside (mini context-manifest); (3) budget enforcement arrives only with the compiler evolution (E2), which will *wrap* `assembleSystemPrompt`, not replace persona/skill loading.

**Migration.** Metadata additive. Rollback: stop recording. Zero behavior change.

**DoD.** Every session records `promptHash`; docs updated.

### M7 — Platform Composition (`packages/platform`)

**Current State.** 727-line `createPlatform` wiring 15+ subsystems; correct pattern (apps never self-assemble), bloated file. Strengths: single composition root, tier-aware. Weaknesses: implicit init ordering, eager init of unused subsystems, hard to navigate.

**Decision: REFACTOR** (mechanical extraction, no behavior change).

**Evolution Strategy.** Extract per-subsystem factory functions into sibling files (`wire-memory.ts`, `wire-channels.ts`, …), `createPlatform` becomes ordered calls. Lazy init only where measured (CLI cold start) and flag-guarded. **30% rule check:** file shrinks but package behavior identical; extraction ≠ redesign.

**Migration.** One `[REFACTOR]` PR, no exports change (`PlatformContext` untouched). Rollback: revert. Existing platform specs (3) must pass unchanged.

**DoD.** `createPlatform` <150 lines; init order explicit; no test changes needed.

### M8 — Skills / Learning / Souls (`packages/skills|learning|souls|soul-gate`)

**Current State.** Trigger matching, composable registry, learning loop (summaries, drafts, nudges), soul-gated evolution. Strengths: differentiating features, learning loop has tests. Weaknesses: per-message full-catalog rescan (perf), micro-package sprawl (souls = 1 file).

**Decision: KEEP + EXTEND.** Feature-complete for tier; only the rescan hurts.

**Evolution Strategy.** Cached trigger index keyed by catalog mtime (P1.S8, ~40-line diff inside `skills`). Package consolidation **deferred** — moving files breaks git history for zero behavior gain; violates minimize-movement rule. Revisit only when plugin extraction (Phase 5) forces relocation anyway.

**DoD.** No full catalog load per message (measured); trigger behavior identical (test with fixture catalog).

### M9 — Observability (`packages/observability` + repo-wide)

**Current State.** Metrics registry (77 LOC, tested), token-usage audit in platform. Weaknesses: no structured logging standard, silent catches repo-wide, no per-call cost metrics, no tracing.

**Decision: KEEP + EXTEND.** Registry stays; add logger + metrics emission points.

**Evolution Strategy.** (1) pino wrapper exported from observability (P1.S2); (2) lint rule bans empty catch; sweep existing `catch {}` → `logger.debug` minimum (mechanical, many files, but each hunk 1-line — diff is wide not deep; acceptable exception to diff-minimization, called out in ADR); (3) model-call metrics at provider registry seam (P1.S3) — one wrapper, not per-provider edits. OTel deferred until server-mode work (additive later).

**DoD.** Zero empty catches; token/cost/latency metrics per model call queryable.

### M10 — Channels / Harness / Workflows / Automation (`packages/channels|harness|workflows|automation|batch`)

**Current State.** 14 channel adapters, harness formatting/approval, DAG executor, cron/hooks, batch. Working, moderately tested (harness 1, automation 2 specs).

**Decision: KEEP.** No active pain; no change until Phase-4 planner consolidation (E7) — and that consolidation itself must re-justify against this ledger when scheduled (workflow YAML compatibility is the constraint, not code preservation).

---

## Decision Matrix Summary

| Module | Decision | Driver |
|---|---|---|
| M1 agents runtime | REFACTOR | testability — **done (EVO-001)** |
| M2 models | KEEP + EXTEND | caching/metering — **caching done (EVO-002)** |
| M3 memory | KEEP + EXTEND | window/distillation behind existing port |
| M4 tools | KEEP + EXTEND | clipping + optional policy fields |
| M5 knowledge | KEEP + EXTEND | hash sync + optional synthesis |
| M6 prompt assembly | KEEP + EXTEND | hash trail now, compiler wraps later |
| M7 platform | REFACTOR | mechanical extraction |
| M8 skills/learning/souls | KEEP + EXTEND | trigger cache only |
| M9 observability | KEEP + EXTEND | logger + metrics seams |
| M10 channels/workflows | KEEP | no active pain |

No REPLACE. No REMOVE (candidates `tools/legacy.ts` + `hermes-tools.spec.ts` naming: audit usage first; removal needs its own EVO entry).

---

## Evolution Ledger

| EVO | Module | Decision | Change | Status | Risk | Rollback |
|---|---|---|---|---|---|---|
| EVO-001 | agents runtime | REFACTOR | extract runtime-loop / tool-executor / approval-node; dedupe approval summary; +8 tests | **Completed** (uncommitted) | M — parity | revert commit |
| EVO-002 | models | KEEP+EXTEND | Anthropic prompt caching + cache usage fields (ADR-0010 L2) | **Completed** (uncommitted) | L | `promptCache: false` / revert |
| EVO-003 | observability | KEEP+EXTEND | pino + empty-catch ban + sweep (P1.S2) | Planned | L | revert |
| EVO-004 | models | KEEP+EXTEND | per-call token/cost/latency metrics at registry seam (P1.S3) | Planned | L | revert |
| EVO-005 | memory | KEEP+EXTEND | sliding window + summarize (P1.S4, ADR-0010 L1) | Planned | M | flag `maxShortTermMessages: 0` |
| EVO-006 | tools | KEEP+EXTEND | output clipping + artifact offload (P1.S5, ADR-0010 L3) | Planned | M | flag |
| EVO-007 | eval seed | — | golden trajectory capture (P1.S6) | Planned | L | n/a (data) |
| EVO-008 | skills | KEEP+EXTEND | trigger index cache (P1.S8) | Planned | L | revert |
| EVO-009 | agents | KEEP+EXTEND | remaining runtime tests: prompt assembly, resume path (P1.S7 rest) | Planned | L | n/a (tests) |
| EVO-010 | prompt assembly | KEEP+EXTEND | prompt hash in session metadata (M6 step 1) | Planned | L | stop recording |
| EVO-011 | platform | REFACTOR | composition-root extraction (M7) | Planned | M | revert |
| EVO-012 | knowledge | KEEP+EXTEND | hash-based incremental sync (M5 step 1) | Planned | L | ignore hash field |

ADR queue: ADR-0010 → Accepted when EVO-005/006 land; ADR-0011 (runtime extraction — records EVO-001 rationale + parity quirk); ADR-0012 (logging standard + catch sweep exception to diff-minimization).

---

## Migration Roadmap (order + rationale)

1. **Commit EVO-001/002** (already built — see commit boundaries).
2. **EVO-003/004** (observability) — measurement before further optimization.
3. **EVO-007** (goldens) — capture current behavior BEFORE window/clipping change it.
4. **EVO-005/006** (window + clipping) — the remaining ADR-0010 savings, validated against goldens + metrics.
5. **EVO-008/009/010** — perf + coverage + traceability, independent, any order.
6. **EVO-011/012** — structural hygiene, schedule opportunistically.

Everything above is v1.2x-line work; no vNext package creation involved. The 30%-rule was checked per module: no module exceeds it (M1 runtime.ts changed heavily but package-level diff is well under; M9 sweep is wide-shallow, ADR'd).

## Testing Plan

Per EVO: unit tests on changed units (done for 001/002); regression = full `pnpm test` + goldens replay once EVO-007 exists; integration = existing `tests/integration` suite must stay green; performance = measure skill-catalog load (EVO-008) and CLI cold start (EVO-011) before/after; token metrics (EVO-004) provide the before/after for EVO-005/006 cost claims.

## Risks

| Risk | Mitigation |
|---|---|
| Window summarization degrades long sessions | goldens first (EVO-007 before 005); flag default-off until fixture eval passes |
| Catch-sweep touches many files | mechanical, 1-line hunks, own PR, ADR-0012 |
| Uncommitted work drifts | commit now (below) |
| Parity gap hidden in EVO-001 | fallthrough quirk already caught + tested; goldens re-verify |

## Rollback Plan

Every EVO independently revertible (table above). Flags: `models.promptCache`, `memory.maxShortTermMessages`, tool clipping budget. No migrations touch stored data destructively; session JSONL remains source of truth throughout.

## Recommended Commit Boundaries (current working tree)

1. `feat(models): anthropic prompt caching + cache-aware token usage (ADR-0010 layer 2)` — core token-usage files + anthropic provider + both specs. (EVO-002)
2. `refactor(agents): extract runtime loop, tool executor, approval node from DefaultAgentRuntime` — agents package files + loop spec. (EVO-001)

Separate commits: independent revertibility, refactor/feature separation.
