# Hermes vNext — Master Engineering Backlog

**Status:** Plan of record. Execute stories in dependency order; one story ≈ one PR.
**Date:** 2026-07-10
**Baseline:** [implementation-blueprint-vnext.md](implementation-blueprint-vnext.md) (frozen). Any story that cannot be built as specified triggers a blueprint ADR, not an ad-hoc deviation.

---

## 0. Backlog Conventions (apply to every story — stated once, not repeated)

**Story ID format:** `E<epic>.F<feature>.S<n>` (e.g. `E1.F2.S3`). Phase-1 stories use `P1.Sn` (they land on the current repo).

**Universal Definition of Done (every story):** compiles via `pnpm build`; `pnpm lint` + `pnpm typecheck` clean; unit tests written and green; contract tests green where a port is touched; no new silent `catch {}` (lint-enforced from P1.S2); public interfaces zod-validated at boundaries; docs touched if behavior/config changed; CHANGELOG entry; PR ≤ ~600 changed LOC target (split if larger); reviewed by package owner.

**Universal Testing Requirements:** colocated `*.spec.ts`; fake-gateway fixtures from `kernel/testing` (built in E0.F1); integration test added to the weekly train when a story crosses package boundaries; golden replay run for any story tagged `[GOLDEN]`.

**Universal Rollback Strategy:** every behavior-changing story ships behind a config flag defaulting to old behavior until its milestone's acceptance gate; schema migrations are forward-only but additive (rollback = ignore new tables/columns); stories tagged `[FLAG:<name>]` name their flag. Pure-additive stories (new package, new port) need no flag.

**Universal Documentation Requirements:** port/interface stories update `docs/` reference page for the package; config stories update the config reference; user-visible stories update the relevant guide.

**Risk levels:** L (isolated/additive), M (touches shared contracts or hot path), H (cutover, data migration, or security-sensitive).

**Estimated Engineering Days (d):** ideal senior days incl. tests. XS≤0.5, S≈1, M≈2–3, L≈4–5, XL split before execution.

**Business value / technical rationale:** stated at Feature level; stories inherit unless noted. Per-story rows list: ID · Title · Description & Acceptance Criteria (AC) · Deps · Size · d · Risk.

---

## 1. Repository Mapping (target packages)

| Package | Owner role | Responsibilities | Key exports | Internal modules | Allowed deps | Prohibited deps |
|---|---|---|---|---|---|---|
| `packages/contracts` | Kernel senior A | schemas, ports, canonical models, event envelope | all ports, zod schemas, `RunEvent`, `ContextManifest` | schemas/, ports/, events/ | none (leaf) | everything |
| `packages/substrate` | Kernel senior A | state/blob/queue/event/secrets impls (SQLite-WAL, Postgres, CAS, NATS) | `StateStore`, `BlobStore(CAS)`, `Queue`, `EventBus`, `Secrets` factories | sqlite/, postgres/, cas/, queue/, events/, secrets/, migrate/ | contracts | runtime, gateways, surfaces |
| `packages/model-gateway` | Kernel senior B | provider adapters, routing, fallback, caching breakpoints, metering, key pools | `ModelGateway`, `ModelDescriptor`, `Router` | adapters/, router/, cache/, meter/, keys/ | contracts, substrate, telemetry | runtime, toolbus |
| `packages/toolbus` | Tools mid | registry, policy gate, executor, output governor, selection, audit, builtins, **mcp/** | `ToolBus`, `ToolProvider`, `ToolPolicy`, `McpAdmin` | registry/, policy/, exec/, govern/, select/, audit/, builtins/, mcp/ | contracts, substrate, telemetry, (sandbox port) | model-gateway, runtime |
| `packages/runtime` | Kernel senior A+B | graph executor, nodes, checkpoints, workers, **compiler/**, **memory/**, **planner/** | `RunService`, `GraphNode`, `ContextCompiler`, `PromptRegistry`, `MemoryManager`, `Workflows` | graph/, state/, lifecycle/, workers/, standard-graph/, compiler/, memory/, planner/ | contracts, substrate, model-gateway, toolbus, knowledge (port), telemetry | surfaces, control-plane, dashboard |
| `packages/knowledge` | Retrieval senior | connectors, sync, chunk, enrich, index, retrieve, rag-eval | `Knowledge`, `Connector`, `KbAdmin` | registry/, connectors/, sync/, chunk/, enrich/, index/, retrieve/, eval/ | contracts, substrate, model-gateway, telemetry | runtime, toolbus |
| `packages/control-plane` | Floating senior | registry, scheduler, policy, approvals, tenancy, **eval/**, **readmodels/** | `Registry`, `Scheduler`, `PolicyService`, `Eval`, insight query API | registry/, sched/, policy/, approvals/, tenancy/, eval/, readmodels/ | contracts, substrate, runtime (RunService port), telemetry | surfaces internals |
| `packages/telemetry` | Kernel senior B | OTel setup, logger, metrics registry, cost attribution | `Telemetry`, `Logger`, metric helpers | otel/, log/, metrics/, cost/ | contracts | all domain packages |
| `packages/testing` | Floating senior | fakes (gateways, stores, MCP server), golden harness, chaos helpers | fixture factories, `ReplayHarness` client | fakes/, goldens/, chaos/ | contracts | production code paths |
| `surfaces/cli` `surfaces/api` `surfaces/web` `surfaces/acp` | Frontend/DX | protocol translation only | — | — | sdk (cli), control-plane API | direct domain imports |
| `sdk/*` | Frontend/DX | per blueprint E10 | — | — | API surface only | kernel internals |
| `plugins/*` | Per plugin | channels, souls, kanban, goals, voice, connectors, guardrails | plugin manifests | — | plugin-kit API | kernel internals |

Layer rule machine-enforced by dependency-cruiser config (P2 story E0.F1.S3). Any story importing against this table = **architecture violation, reject in review.**

---

## 2. Master Engineering Backlog

### Phase 1 stories (current repo — `packages/*` of v1)

*Feature value: immediate cost cut + measurement + golden capture that gates the whole program.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| P1.S1 | Anthropic prompt caching | `cache_control` breakpoints on system prompt + last tool def in `anthropic.provider.ts`. AC: cache-read tokens visible in usage; hit ratio >60% on ≥3-turn sessions; no output diff on goldens. `[FLAG:models.promptCache]` | — | S | 1 | M |
| P1.S2 | Structured logging + ban silent catch | pino logger injected; lint rule `no-empty-catch`; all `catch {}` get `logger.debug` minimum. AC: zero empty catches repo-wide. | — | M | 2 | L |
| P1.S3 | Token/cost/latency metrics per model call | emit `tokens_in/out/cached, cost_est, latency_ms, provider, model` per call via observability registry. AC: metrics queryable; cost table per provider. | P1.S2 | S | 1 | L |
| P1.S4 | Sliding window + summarize-on-overflow | ADR-0010 L1 in `FilesystemMemoryStore`; config `memory.maxShortTermMessages` (default 40), summarizer via existing `@anvio/learning`. AC: history bounded; raw log retained on disk; goldens unaffected below window. `[FLAG]` | P1.S3 | M | 3 | M |
| P1.S5 | Tool-output clipping + artifact offload | head/tail clip at `tools.outputBudgetBytes`; full payload to workspace artifact; reference line in context. AC: no tool result >budget enters messages. `[FLAG]` | — | M | 2 | M |
| P1.S6 | Golden trajectory capture | record ~50 representative sessions (mix: chat, tool-heavy, approval, multi-turn) via existing `trajectory-export`; store under `evals/goldens/v1-seed/`. AC: replayable JSON, reviewed, committed. | P1.S3 | M | 2 | L |
| P1.S7 | Agent tool-loop unit tests (v1) | tests for `runtime.ts`: iteration loop, native vs parsed paths, checkpoint build/read, stop, approval suspend. AC: ≥85% line coverage on `agents` package. | — | L | 4 | L |
| P1.S8 | Skill-trigger index cache | cache catalog trigger index, invalidate on file mtime. AC: no per-message full catalog load (measured). | — | S | 1 | L |

### Epic 0 — Foundations (new repo layout; Phase 2 start)

**F1 Scaffolding & guardrails** — *value: architecture integrity is enforced, not hoped.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E0.F1.S1 | Kernel package scaffolding | create `packages/{contracts,substrate,telemetry,testing}` skeletons + turbo wiring per §1. AC: builds, empty exports. | P1 done | S | 1 | L |
| E0.F1.S2 | Contracts v0: core schemas + ports | port v1 `core` schemas worth keeping; add `RunEvent`, port interfaces stubs (StateStore, BlobStore, Queue, EventBus, Secrets, ModelGateway, ToolBus, Knowledge, MemoryManager). AC: zod schemas + TS ports compile; contract-test skeletons. | S1 | L | 4 | M |
| E0.F1.S3 | dependency-cruiser layer enforcement | CI fails on prohibited imports per §1 table. AC: violation in fixture branch fails CI. | S1 | S | 1 | L |
| E0.F1.S4 | telemetry package | OTel init, pino wrapper, metrics registry, cost-attribution helper. AC: span/log/metric from a sample app visible in console + OTLP exporters. | S1 | M | 2 | L |
| E0.F1.S5 | testing package: fakes v0 | fake ModelGateway (scripted responses), fake stores, fake EventBus. AC: used by ≥1 test in each kernel package. | S2 | M | 2 | L |

**F2 Substrate** — *value: one storage story for both tiers; kills JSON-rewrite races.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E0.F2.S1 | Migration framework (dual dialect) | schema-once, SQLite/Postgres generated; `hermes migrate`. AC: same logical schema on both engines in CI matrix. | E0.F1.S2 | M | 3 | M |
| E0.F2.S2 | StateStore: SQLite WAL impl | sessions/runs/checkpoints tables + CRUD. AC: contract suite green; concurrent-writer test green (v1 race regression test). | S1 | M | 3 | M |
| E0.F2.S3 | StateStore: Postgres impl + RLS scaffolding | same contract; `tenant_id` RLS policies (enforced later). AC: contract suite green on PG. | S2 | M | 2 | M |
| E0.F2.S4 | BlobStore: filesystem CAS | sha256-addressed put/get/link; GC by refcount. AC: contract suite; dedup verified. | S1 | M | 2 | L |
| E0.F2.S5 | BlobStore: S3 impl | AC: contract suite vs MinIO in CI. | S4 | S | 1 | L |
| E0.F2.S6 | Queue: SQLite-backed + NATS impls | lease/ack/retry semantics, per-tenant fairness keys. AC: contract suite both; lease-expiry chaos test. | S2 | L | 4 | M |
| E0.F2.S7 | EventBus: in-process + NATS, CloudEvents envelope | at-least-once, idempotency keys. AC: contract suite; duplicate-delivery consumer test. | S1 | M | 2 | M |
| E0.F2.S8 | Secrets: age-file + KMS port | encrypt at rest; redaction filter registered into logger. AC: secret never appears in logs (test greps). | E0.F1.S4 | M | 2 | H |
| E0.F2.S9 | v1 data importer: sessions/memory → substrate | checksummed import of `sessions/*.jsonl`, memory JSON. AC: round-trip count+hash verification; idempotent re-run. | S2,S4 | M | 3 | H |

### Epic 12 (Design) — Model Gateway *(scheduled in Phase 2; numbered E12 to match Design §12)*

**F1 Canonical model + adapters** — *value: one choke point; provider swap without domain change.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E12.F1.S1 | Canonical request/response + ModelDescriptor | schema for messages/tools/cache-hints/thinking; descriptor registry (window, caps, cost). AC: schemas frozen via RFC-3-adjacent review. | E0.F1.S2 | M | 3 | M |
| E12.F1.S2 | Anthropic adapter | port v1 provider onto canonical model incl. cache breakpoints. AC: adapter contract suite (fixture exchanges); usage incl. cache tokens. | S1 | M | 3 | M |
| E12.F1.S3 | OpenAI-compatible adapter | covers OpenAI/DeepSeek/Groq/Ollama/vLLM. AC: contract suite; tool-call mapping tests (port v1 spec cases). | S1 | M | 3 | M |
| E12.F1.S4 | Gemini adapter | AC: contract suite; port v1 `gemini-messages` cases. | S1 | M | 2 | M |
| E12.F1.S5 | AbortSignal propagation | signal → HTTP abort all adapters. AC: cancel test: abort <500ms after signal. | S2–S4 | S | 1 | L |

**F2 Routing, fallback, metering** — *value: keeps v1's best subsystem, adds health + budgets.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E12.F2.S1 | Router: route tiers + task classifier port | port v1 `classifyTask`; tier config (reasoning/coding/fast/vision/embed/rerank). AC: v1 routing tests pass on new router. | E12.F1.S1 | M | 2 | L |
| E12.F2.S2 | Fallback chains + circuit breaker per provider | health-aware skip, downgrade rules, events on fallback. AC: fault-injection suite (provider 500s/timeouts). | S1 | M | 3 | M |
| E12.F2.S3 | Usage metering + spend limits | per-tenant/run token+cost ledger; hard budget → typed error; degradation hook for router. AC: budget breach test; ledger feeds telemetry. | E0.F1.S4 | M | 2 | M |
| E12.F2.S4 | Key pools (encrypted, rotating) | port v1 credentials pool onto Secrets. AC: rotation test; explicit precedence config (kills env-shadowing bug class). | E0.F2.S8 | M | 2 | H |
| E12.F2.S5 | v1 adapter shim (`gateway.model: legacy\|vnext`) | v1 runtime calls gateway via `ModelProvider`-shaped shim. AC: all v1 integration tests green through shim. `[GOLDEN][FLAG]` | S1–S4 | M | 3 | H |

### Epic 5 — Tool Bus (core in Phase 2, rest Phase 4)

**F1 Registry + policy + execution** — *value: governance replaces boolean flags; schema-token cut.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E5.F1.S1 | ToolRegistry + ToolPolicy schema + layered resolution | default→tenant→project→agent merge. AC: decision-table tests for merge precedence. | E0.F1.S2 | M | 2 | M |
| E5.F1.S2 | PolicyGate | scope/approval/rate/tainted-turn verdicts. AC: exhaustive decision-table tests; deny → synthetic tool error shape. | S1 | M | 3 | H |
| E5.F1.S3 | Executor: timeout, retry, parallel independent calls | per-policy timeout race; bounded parallelism. AC: fault-injection matrix (hang/throw/slow). | S1 | M | 3 | M |
| E5.F1.S4 | OutputGovernor + read_artifact tool | token-budget clip, CAS offload, reference format. AC: property test — result never exceeds budget, artifact always retrievable. | E0.F2.S4 | M | 2 | M |
| E5.F1.S5 | ToolAuditor | immutable audit row per call (hashes, verdicts, latency). AC: invariant test — execute count == audit count. | S3 | S | 1 | M |
| E5.F1.S6 | Builtins port wave 1 (safe pack) | file_read, glob, grep, list_dir, http, json, datetime, memory_recall etc. onto ToolProvider. AC: v1 tool spec tests carried over. | S3 | L | 4 | M |
| E5.F1.S7 | Builtins port wave 2 (gated pack) | shell, edit/patch, browser family, execute_code — sandbox-tier tagged, approval defaults. AC: policy defaults verified; v1 tests pass. | S6, E5.F2.S1 | L | 4 | H |
| E5.F1.S8 | v1 gateway YAML → policy converter | boolean → policy objects. AC: converter round-trip on v1 default YAML; deprecation warning path. | S1 | S | 1 | L |

**F2 Sandbox + selection + streaming (Phase 4)**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E5.F2.S1 | Sandbox tiers: none/process/container dispatch | process isolation (rlimits, scoped FS view); container via Docker port. AC: escape-attempt test suite; FS scope test. | E5.F1.S3 | L | 5 | H |
| E5.F2.S2 | SelectionService + tool_search meta-tool | declared ∪ route-matched ∪ recent; miss-rate metric. AC: schema tokens per turn reduced ≥60% on fixture agents; search finds long tail. | E5.F1.S1 | M | 3 | M |
| E5.F2.S3 | Circuit breaker per tool + health withdrawal | AC: breaker opens on threshold, tool leaves offered set, advisory event emitted. | E5.F1.S3 | M | 2 | L |
| E5.F2.S4 | Streaming/long-running tools | progress events to run stream; heartbeat; detach → event-wait. AC: long-tool fixture streams + survives run suspend. | E1.F2.S3 | M | 3 | M |

### Epic 1 — Runtime Engine (Phase 3)

**F1 Executor + state** — *value: durability, testability; unblocks compiler/planner/eval.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E1.F1.S1 | GraphNode contract + NodeContext (RFC-1) | typed node port, capability-scoped context, NodeOutcome. AC: RFC merged; fake node kit in testing pkg. | E0.F1.S2 | M | 3 | H |
| E1.F1.S2 | Checkpoint codec (RFC-2) | zod-validated, delta-encoded, CAS refs for large payloads. AC: encode/decode property tests; corrupt-checkpoint rejection (kills v1 `as unknown as` hole). | E0.F2.S2,S4 | M | 3 | M |
| E1.F1.S3 | GraphExecutor core | node walk, ckpt-after-node, status machine, resume-from-ckpt. AC: crash-at-every-node property test → resume equivalence. | S1,S2 | L | 5 | H |
| E1.F1.S4 | RunService + RunEventPublisher | start/resume/cancel; `run.<id>.*` topics; RunHandle event iterator. AC: SSE-shaped consumer test; status transitions exhaustive. | S3, E0.F2.S7 | M | 3 | M |
| E1.F1.S5 | CancellationController | signal tree run→node→gateway. AC: mid-stream cancel test end-to-end (with E12.F1.S5). | S3 | S | 1 | L |

**F2 Standard graph + nodes**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E1.F2.S1 | Nodes: intake + finalize + model | intake provenance/guardrail hook; model node streams via gateway. AC: node unit tests with fakes. | F1.S3, E12 | M | 3 | M |
| E1.F2.S2 | Nodes: route + tool-exec | parallel calls via ToolBus; loop edge. AC: multi-tool turn test; wall-clock parallelism asserted. | S1, E5.F1 | M | 3 | M |
| E1.F2.S3 | ApprovalCoordinator + approval-wait node | suspend/resume protocol, expiry timers, tainted-turn integration. AC: suspend→decide→resume across process restart. | S2 | M | 3 | H |
| E1.F2.S4 | Standard graph assembly + config surface | ReAct+ graph, `runtime.maxIterations=24`, per-agent params. AC: graph golden shape test. | S1–S3 | S | 1 | L |
| E1.F2.S5 | Learn node (async hook) | post-run event emission; proposal envelope (consumed by E3). AC: fires off critical path; failure isolated. | S4 | S | 1 | L |

**F3 Workers + cutover**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E1.F3.S1 | WorkerPool: lease, heartbeat, orphan recovery | per-tenant concurrency fairness. AC: kill-worker chaos → run recovered ≤ lease TTL. | F1.S3, E0.F2.S6 | L | 4 | H |
| E1.F3.S2 | Golden replay harness (E8.F1.S2 pulled early) + parity gate | replay v1 seed goldens through standard graph via fakes. AC: ≥98% trajectory equivalence; diffs triaged. `[GOLDEN]` | F2.S4, P1.S6 | L | 4 | H |
| E1.F3.S3 | Runtime cutover flag + v1 checkpoint importer | `runtime.engine: legacy\|graph`; approval-ckpt conversion. AC: v1 suspended sessions resumable on graph engine. `[FLAG]` | S2 | M | 3 | H |

### Epic 2 — Prompt Engine (Phase 3)

**F1 Registry + manifest** — *value: reproducibility; eval attribution.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E2.F1.S1 | PromptRegistry (CAS-backed, lineage) | put/get/lineage; kinds: persona/skill/header/template. AC: hash stability tests; lineage query. | E0.F2.S4 | M | 2 | L |
| E2.F1.S2 | ContextManifest schema (RFC-3) + persistence in checkpoints | AC: manifest recorded per model call; run inspector can list segments. | S1, E1.F1.S2 | M | 2 | M |

**F2 Compiler**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E2.F2.S1 | Segment model + SegmentProvider port + TemplateEngine | logic-less interpolation; provenance framing applied here. AC: framing test — untrusted segment always wrapped. | E2.F1.S1 | M | 3 | M |
| E2.F2.S2 | TokenBudgetManager + degradation ladder | descriptor-derived budget; drop/summarize priority order; `prompt.budget.degraded` event. AC: property tests — never exceed window; ladder order stable. | S1, E12.F1.S1 | M | 3 | M |
| E2.F2.S3 | HistoryWindower + rolling summary | window + cheap-route summary; raw log untouched. AC: long-session fixture — coherence eval ≥ baseline; bounded output. | S2 | M | 3 | M |
| E2.F2.S4 | Cache-aware ordering + breakpoint placement | stable-first ordering; breakpoints via gateway hints. AC: cache-hit ratio ≥ target on multi-turn fixture (with E12.F1.S2). | S2 | M | 2 | M |
| E2.F2.S5 | compile-context node integration | replaces v1 `assembleSystemPrompt` semantics; parity snapshot vs v1 output for same inputs. AC: golden replay unaffected. `[GOLDEN]` | S1–S4, E1.F2.S4 | M | 3 | H |
| E2.F2.S6 | PromptValidator + prompt tests in CI | ceilings, must-contain, forbidden content; registry gate hook. AC: failing prompt test blocks CI on fixture. | E2.F1.S1 | M | 2 | L |

### Epic 3 — Memory Engine (Phase 3–4)

**F1 Lanes + recall** — *value: recall quality per token; GDPR path.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E3.F1.S1 | LaneStore port + SQLite impl (FTS5+sqlite-vec) | episodic/semantic tables per §blueprint. AC: contract suite; hybrid query works. | E0.F2.S2 | L | 4 | M |
| E3.F1.S2 | MemoryManager: propose/recall/forget | write-policy gate (Learn node + user command only); ranked recall (`relevance×recency×type×confidence`). AC: ranking golden sets; forget removes + tombstones. | S1 | M | 3 | M |
| E3.F1.S3 | Recall → compiler segment provider | budget-capped, provenance-tagged injection. AC: injected tokens ≤ budget; provenance visible in manifest. | S2, E2.F2.S1 | S | 1 | L |
| E3.F1.S4 | Distiller (episodic + semantic writers) | Learn-node consumer; cheap-route summarize/fact-extract; dedupe + supersession. AC: schema-valid proposals; contradiction test — supersede not delete. | S2, E1.F2.S5 | L | 4 | M |
| E3.F1.S5 | ExpiryService + TTL config | sweep workflow; compaction. AC: expiry honors per-lane TTL; lineage kept. | S1, E7.F1.S3 | M | 2 | L |
| E3.F1.S6 | Postgres lane impl + PII hook + v1 memory importer | pgvector; PII detect policy block/redact/allow; distill v1 blobs batch job. AC: contract suite PG; importer idempotent; PII test corpus. | S1,S4, E0.F2.S9 | L | 4 | H |

### Epic 4 — Knowledge Engine (Phase 4)

**F1 Ingest pipeline** — *value: real RAG replaces stub; incremental cost.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E4.F1.S1 | Canonical doc model + KnowledgeRegistry | docs/versions/ACL schema; KB version = snapshot set. AC: schema review; registry CRUD tests. | E0.F1.S2 | M | 3 | M |
| E4.F1.S2 | Connectors: file + git | list/fetch/changed-since; provenance. AC: connector contract suite on fixture corpora. | S1 | M | 3 | L |
| E4.F1.S3 | SyncEngine: hash-diff incremental, resumable batches | queue-backed; only changed docs flow. AC: 2nd sync of unchanged corpus processes 0 docs; kill-mid-sync resume test. | S2, E0.F2.S6 | L | 4 | M |
| E4.F1.S4 | Chunker: structure-aware + parent-child | headings (md/docs), AST symbols (code). AC: golden chunk snapshots per fixture type. | S1 | L | 4 | M |
| E4.F1.S5 | Indexer: FTS generation build + atomic swap | two-phase; generation bookkeeping. AC: swap atomicity test (query during build sees old gen). | S3,S4 | M | 3 | M |
| E4.F1.S6 | Embedding pipeline + vector index + embedding-version stamping | batch-lane embeds; never mix spaces. AC: re-embed generation test on model change. | S5, E12.F2.S1 | L | 4 | M |
| E4.F1.S7 | Enricher: contextual headers (batch LLM) | per-chunk doc-context prepend. AC: enriched vs plain retrieval A/B on eval set shows gain (gate: keep only if measured). | S6, E8.F2.S1 | M | 3 | M |
| E4.F1.S8 | Connectors: web crawler + Confluence | rate-limited, ACL-importing (Confluence). AC: contract suite; ACL mapped to doc ACL. | S2 | L | 5 | M |

**F2 Retrieval + permissions**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E4.F2.S1 | Hybrid retriever: BM25+vector, RRF, metadata filters | BM25-only fallback path (Level-1). AC: recall@k ≥ BM25 baseline on labeled sets. | F1.S5,S6 | L | 4 | M |
| E4.F2.S2 | Parent expansion + dedup + budget compression | AC: passage set fits budget; parent expansion capped. | S1, E2.F2.S2 | M | 2 | L |
| E4.F2.S3 | ACL-in-retrieval enforcement | filter inside query, never post-hoc. AC: adversarial test — unauthorized doc never in results regardless of budget/rerank. | S1, F1.S1 | M | 2 | H |
| E4.F2.S4 | Knowledge → compiler segment provider + KB version pinning | AC: agent pinned to KB@vN retrieves only vN docs. | S2 | S | 1 | L |
| E4.F2.S5 | Reranker plugin slot + reference impl | optional cross-encoder. AC: pluggable; eval shows when it pays. | S1, E8.F2.S1 | M | 2 | L |
| E4.F2.S6 | v1 knowledge importer | `knowledge/raw` → file connector KBs; wiki copies dropped. AC: idempotent; manifest converted. | F1.S2 | S | 1 | L |

### Epic 6 — MCP Gateway (Phase 4)

**F1 Client fleet** — *value: reliability + security on fastest-growing tool surface.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E6.F1.S1 | McpRegistry + trust tiers + config conversion | v1 integration configs auto-convert; trust→policy defaults mapping. AC: converter tests; tier defaults verified. | E5.F1.S1 | M | 2 | M |
| E6.F1.S2 | ClientManager: transports, pool, stdio supervision | lazy connect, backoff, zombie kill. AC: fault matrix vs fixture server (hang/disconnect/malformed). | S1 | L | 4 | M |
| E6.F1.S3 | CatalogService → ToolRegistry + description sanitizer | normalized descriptors; description-injection defense. AC: hostile-description corpus neutralized; catalog TTL + invalidate-on-error. | S2 | M | 3 | H |
| E6.F1.S4 | AuthBroker: OAuth via control plane, token refresh | encrypted storage; per-user vs workspace identity. AC: refresh race test; token never logged. | S2, E0.F2.S8 | L | 4 | H |
| E6.F1.S5 | HealthMonitor + CompatLayer | probes, withdrawal, version negotiation + graceful degradation. AC: unhealthy server's tools leave selection; old-protocol fixture degrades not crashes. | S3 | M | 3 | M |
| E6.F1.S6 | Hermes-as-MCP-server facade | expose agents/memory.recall/knowledge.query. AC: external MCP client (fixture) drives an agent end-to-end. | E1.F1.S4 | M | 3 | M |

### Epic 7 — Planner Engine (Phase 4)

**F1 Workflows** — *value: consolidates 4 v1 packages; durable scheduled agents.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E7.F1.S1 | Workflow YAML schema (RFC-4) + WorkflowRegistry | hash-versioned defs. AC: RFC merged; schema validation corpus. | E1.F2.S4 | M | 2 | M |
| E7.F1.S2 | WorkflowCompiler → executor graphs | step types: agent-run, tool, human-gate, timer, event-wait, sub-workflow, bounded map/fan-out. AC: YAML→graph golden shape tests; loop-bounding enforced. | S1 | L | 5 | H |
| E7.F1.S3 | TriggerService: cron + event + webhook | absorbs v1 automation; missed-schedule recovery. AC: v1 cron specs migrate; zero missed schedules in restart chaos test. | S2, E0.F2.S6 | M | 3 | M |
| E7.F1.S4 | SubRunManager: typed spawn/await, fan-out caps, permission intersection | AC: contract-violation test (child result schema); no-escalation test. | S2, E1.F1.S4 | M | 3 | H |
| E7.F1.S5 | Human-gate durable suspend + workflow templates | fan-out/verify, judge-panel, pipeline, supervisor templates. AC: suspend across restart; templates in `workflows/` run green. | S4, E1.F2.S3 | M | 3 | M |

**F2 Planning + reflection**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E7.F2.S1 | Decomposer (goal → plan in working memory) | revisable plan state; route by size. AC: plan schema tests; replaces v1 task-planner cases. | E1.F2.S4 | M | 3 | M |
| E7.F2.S2 | ReflectionPolicy + reflect node | triggers (error streak, guardrail, cadence), bounded attempts, budget-capped. AC: simulation on recorded failures — success lift measured, cap never exceeded. | S1, E8.F1 | M | 3 | M |
| E7.F2.S3 | Critic + Evaluator nodes in NodeKit | rubric critique; checker scoring; reusable in workflows. AC: node unit tests; used by judge-panel template. | S2 | M | 2 | L |

### Epic 8 — Evaluation Framework (Phase 3 start, Phase 4 complete)

**F1 Goldens + replay + gate** — *value: makes every other epic's claims falsifiable; gates cutover.*

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E8.F1.S1 | GoldenStore + golden review workflow | CAS-versioned trajectories/sets; code-review process for goldens. AC: v1 seed imported; provenance recorded. | P1.S6, E0.F2.S4 | M | 2 | L |
| E8.F1.S2 | ReplayHarness (deterministic, fake gateways) | (delivered early as E1.F3.S2 — this story: generalize + benchmark live mode). AC: same golden replays identically twice. | E1.F3.S2 | M | 2 | M |
| E8.F1.S3 | Scorers v1: structural checkers + trajectory comparator | AC: labeled agreement ≥ target on fixture sets. | S2 | M | 3 | M |
| E8.F1.S4 | CI gate: hash-change → affected suites → score diff | registry integration; gate policy per artifact kind. AC: fixture persona regression blocks CI. | S3, E2.F1.S1 | M | 2 | M |

**F2 Judge, bench, experiments**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E8.F2.S1 | Retrieval eval harness + labeled sets | recall@k, faithfulness sampler. AC: baselines published for E4 gates. | E4.F2.S1 | M | 3 | M |
| E8.F2.S2 | LLM-judge scorer (pinned judge, structured output, injection-hardened) | agreement audit vs human labels. AC: audit ≥ threshold; judge version locked in config. | F1.S3 | M | 3 | H |
| E8.F2.S3 | BenchService: cost/latency/token per model+prompt-version | model comparison matrix. AC: bench run produces matrix consumed by dashboard. | E12.F2.S3 | M | 2 | L |
| E8.F2.S4 | ScoreLedger read model + drift sampling | scores → per-hash series; nightly sampled live scoring. AC: ledger query API; drift alert fires on fixture regression. | S2, E9.F1.S1 | M | 3 | M |
| E8.F2.S5 | ExperimentService: A/B split + guarded rollout | prompt-version traffic split; auto-rollback on score drop. AC: rollback fires in simulated regression. | S4 | L | 4 | H |

### Epic 9 — Dashboard (Phase 4–5)

**F1 Read models + core views**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E9.F1.S1 | Read-model projection framework (RFC-7) | idempotent projectors from event log; rebuildable `rm_*` tables; staleness indicator. AC: replay determinism test. | E0.F2.S7 | L | 4 | M |
| E9.F1.S2 | System/Health + Runtime views + live run stream | AC: SSE live view; v1 overview endpoints aliased. | S1, E1.F1.S4 | L | 4 | L |
| E9.F1.S3 | Approval inbox (actionable) | list/decide/expiry; RBAC. AC: decide → run resumes end-to-end. | S2, E1.F2.S3 | M | 3 | M |
| E9.F1.S4 | Run inspector (checkpoints + manifests replay view) | AC: any run browsable node-by-node with segment/token detail. | S2, E2.F1.S2 | L | 4 | M |
| E9.F1.S5 | Token/Cost + Model views | spend by dims, cache savings, budget forecasts, fallback/latency panels. AC: numbers reconcile with metering ledger (test). | S1, E12.F2.S3 | M | 3 | L |

**F2 Quality + governance views (Phase 5)**

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E9.F2.S1 | Prompt + Evaluation views | lineage, score series, gates, experiments. AC: deep-links to versions/runs. | E8.F2.S4 | M | 3 | L |
| E9.F2.S2 | Memory + Knowledge views | lane sizes, recall precision, sync/freshness, index gens. AC: stale-doc alert visible. | E3,E4 | M | 3 | L |
| E9.F2.S3 | Workflow view + Audit search + trace viewer link-out | AC: audit query over control-plane mutations/approvals/tool calls. | E7, E5.F1.S5 | M | 3 | M |
| E9.F2.S4 | Dashboard RBAC + PII-redacted projections | finance sees cost not transcripts; transcript access audited. AC: RBAC matrix tests. | F1 all | M | 3 | H |

### Epic 10 — SDK (Phase 5)

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| E10.F1.S1 | OpenAPI spec generated from contracts | single source; CI drift check. AC: spec validates; breaking-change detector wired. | E0.F1.S2, API | M | 3 | M |
| E10.F1.S2 | TS SDK L1–L2 (chat, sessions/runs/events/approvals, memory/knowledge query) | AC: integration suite vs ephemeral kernel; streaming iterator ergonomics reviewed. | S1 | L | 5 | M |
| E10.F1.S3 | CLI refactor onto SDK | completeness proof; command surface preserved with aliases. AC: CLI e2e suite green; no direct kernel imports (dep-cruiser). | S2 | L | 5 | H |
| E10.F1.S4 | TS SDK L3: custom tools/nodes/graphs | AC: example custom node runs in standard graph slot. | S2, E1.F1.S1 | M | 3 | M |
| E10.F2.S1 | Plugin-kit + manifest/permission grammar (RFC-6) + scaffolder | local test harness with fakes. AC: fixture plugin passes harness; capability grants enforced. | E10.F1.S4 | L | 5 | H |
| E10.F2.S2 | First-party plugin extraction: channels | v1 channels → plugins on plugin-kit. AC: Slack/Discord adapters pass v1 channel tests as plugins. | S1 | L | 5 | H |
| E10.F2.S3 | Plugin extraction: souls, kanban, goals, voice | AC: feature parity smoke suites; kernel no longer imports them. | S2 | L | 5 | M |
| E10.F3.S1 | Python client + toolkit (MCP-based tools) | generated client + hand ergonomics; toolkit typed helpers. AC: example Python tool served + called by agent. | E10.F1.S1, E6.F1.S6 | L | 4 | M |
| E10.F3.S2 | Go client + toolkit | AC: same as Python at client tier. | E10.F1.S1 | M | 3 | L |
| E10.F3.S3 | Examples repo + quickstart timing gate + API reference | 10 recipes run in CI; quickstart ≤15 min measured. AC: timing test in release checklist. | F1–F3 | M | 3 | L |

### Control plane & tenancy stories (Phase 5, from Design §16–17 — grouped as Epic CP)

| ID | Title | Description & AC | Deps | Size | d | Risk |
|---|---|---|---|---|---|---|
| CP.S1 | Registry: agent/skill/workflow versioning + activation gates | content-hash versions, lineage, session pinning, eval-gate hook. AC: pinning test; gate blocks activation on fixture. | E2.F1.S1, E8.F1.S4 | L | 4 | M |
| CP.S2 | PolicyService: subjects/grants/intersection | agent-for-user = intersected permissions. AC: policy decision tests incl. escalation attempts. | E0.F1.S2 | L | 4 | H |
| CP.S3 | Tenancy: RLS enforcement + per-tenant keys + queue fairness | AC: adversarial cross-tenant suite; external pentest scheduled. | E0.F2.S3, CP.S2 | L | 5 | H |
| CP.S4 | Rate limiting + spend budgets at surfaces/gateway | AC: limit breach → 429/typed error; budget → degradation ladder engages. | E12.F2.S3 | M | 3 | M |
| CP.S5 | SSO/OIDC + scoped API keys | AC: OIDC login e2e; key scopes enforced per capability. | CP.S2 | L | 4 | H |
| CP.S6 | Audit trail completion + retention | immutable events for all control-plane mutations. AC: audit completeness invariant tests. | E0.F2.S7 | M | 2 | M |

**Backlog totals: ~118 stories · ~330 engineering days ≈ 66 ew — consistent with blueprint's ~61 ew + integration overhead.**

---

## 3. Dependency Graph

```
P1.S1..S8 (v1, parallel) ──► P1.S6 goldens ─────────────────────────┐
                                                                    │
E0.F1.S1─►S2─►(S3,S4,S5)                                            │
        └─►E0.F2.S1─►S2─►(S3,S6)  S1─►(S4─►S5, S7, S8)  S2+S4─►S9   │
                                                                    │
E0.F1.S2 ─► E12.F1.S1 ─► (S2,S3,S4) ─► S5 ─► E12.F2.S1─►S2         │
                                        E12.F2.S3, S4 ─► S5(shim)   │
E0.F1.S2 ─► E5.F1.S1─►(S2,S3)─►(S4,S5,S6)─►S7   S1─►S8             │
                                                                    ▼
E1.F1.S1─►S2─►S3─►(S4,S5) ─► E1.F2.S1─►S2─►S3─►S4─►S5 ─► E1.F3.S1
                                              E1.F3.S2 ◄── goldens ─┘
                                              E1.F3.S3 (CUTOVER GATE)
E2.F1.S1─►S2   E2.F2.S1─►S2─►(S3,S4)─►S5─►S6
E3.F1.S1─►S2─►(S3,S4)─►(S5,S6)
E4.F1.S1─►S2─►S3─►S5   S1─►S4─►S5─►S6─►S7   S2─►S8
E4.F2: F1.S5+S6─►S1─►(S2,S3,S5)─►S4   F1.S2─►S6
E6.F1.S1─►S2─►(S3,S4,S5)─►S6
E7.F1.S1─►S2─►(S3,S4)─►S5   E7.F2.S1─►S2─►S3
E8.F1.S1─►S2─►S3─►S4   E8.F2.S1..S5 (after E4.F2.S1, E12.F2.S3)
E9.F1.S1─►(S2..S5)─►E9.F2.*
E10.F1.S1─►S2─►(S3,S4)─►F2.S1─►(F2.S2,F2.S3)   F1.S1─►F3.*
CP.S2─►(S3,S5)   CP.S1 after E8.F1.S4
```

**Critical path:** `P1.S6 → E0.F1.S2 → E0.F2.S2 → E12.F1.S1→S2 → E1.F1.S1→S2→S3 → E1.F2.S1→S2→S3→S4 → E1.F3.S2 (golden parity) → E1.F3.S3 (cutover) → E2.F2.S5 → E7.F1.S2 → E10.F2.S1 → plugin extraction`. ≈ 45 days of serialized work — everything else parallelizes around it.

**Parallel lanes (post-E0):** Lane A executor (E1) · Lane B compiler/registry (E2) · Lane C toolbus+builtins (E5) · Lane D gateway adapters (E12) · Lane E memory (E3) · then Phase 4: knowledge (E4) ∥ MCP (E6) ∥ planner (E7) ∥ eval (E8) ∥ dashboard (E9).

**Architectural milestones:** ◆A substrate contract suites green (E0.F2) · ◆B v1-on-gateways (E12.F2.S5) · ◆C golden parity (E1.F3.S2) · ◆D cutover (E1.F3.S3) · ◆E manifests everywhere (E2.F2.S5) · ◆F RAG eval baseline (E8.F2.S1) · ◆G workflows durable (E7.F1.S5) · ◆H tenancy pentest pass (CP.S3) · ◆I plugin API v1 (E10.F2.S1).

---

## 4. Pull Request Roadmap

One story = one PR by default; below, multi-story PRs are only where stories are inseparable. PR numbers are sequence, not GitHub IDs. All PRs: must compile, tests green, backward compatible unless tagged **[BREAKING-PLANNED]**, no refactor+feature mixing (refactor PRs tagged **[REFACTOR]**).

| PR | Objective | Stories | Size | Packages | Migration notes | Test focus |
|---|---|---|---|---|---|---|
| 1–8 | Phase 1 on v1 repo | P1.S1–S8 (one each) | S–M | v1 models/memory/tools/agents/observability | all flag-guarded | goldens, cache metrics |
| 9 | kernel scaffolding + layer CI | E0.F1.S1,S3 | S | new pkgs, CI | none | dep-cruiser fixture |
| 10 | contracts v0 | E0.F1.S2 | L | contracts | none | schema tests |
| 11 | telemetry + testing fakes | E0.F1.S4,S5 | M | telemetry, testing | none | exporter smoke |
| 12–17 | substrate impls (one PR per port-pair) | E0.F2.S1–S8 | M–L | substrate | migrations additive | contract suites both engines |
| 18 | v1 data importer | E0.F2.S9 | M | substrate, tools | checksummed, idempotent | round-trip |
| 19–23 | gateway: canonical model; adapters ×3; abort | E12.F1.S1–S5 | M | model-gateway | none | adapter contract fixtures |
| 24–26 | router, breaker/fallback, metering+keys | E12.F2.S1–S4 | M | model-gateway | key pool migrate from v1 credentials | fault injection |
| 27 | **v1-on-gateway shim** ◆B | E12.F2.S5 | M | v1 platform + gateway | `gateway.model` flag | full v1 integration suite |
| 28–33 | toolbus core + builtins waves + converter | E5.F1.S1–S8 | M–L | toolbus | YAML converter, deprecation warn | decision tables, v1 tool tests |
| 34–38 | executor: node contract, codec, core, runservice, cancel | E1.F1.S1–S5 | M–L | runtime | none | crash-resume property |
| 39–43 | standard-graph nodes | E1.F2.S1–S5 | M | runtime | none | node units, approval restart |
| 44 | worker pool | E1.F3.S1 | L | runtime | none | chaos kill |
| 45 | golden parity harness ◆C | E1.F3.S2, E8.F1.S1,S2 | L | runtime, control-plane/eval, testing | goldens imported | ≥98% equivalence |
| 46 | **runtime cutover flag** ◆D [BREAKING-PLANNED next minor] | E1.F3.S3 | M | runtime, platform glue | v1 ckpt importer | suspended-session resume |
| 47–48 | prompt registry + manifest | E2.F1.S1,S2 | M | runtime/compiler | none | hash stability |
| 49–53 | compiler: segments, budget, window, cache-order, node swap ◆E | E2.F2.S1–S5 | M | runtime/compiler | parity snapshot vs v1 | budget properties, goldens |
| 54 | prompt validator + CI gate | E2.F2.S6, E8.F1.S4 partial | M | compiler, eval, CI | gate advisory first release | fixture regression blocks |
| 55–59 | memory lanes, manager, segment, distiller, expiry | E3.F1.S1–S5 | M–L | runtime/memory | none | ranking goldens |
| 60 | memory PG + PII + importer | E3.F1.S6 | L | memory, substrate | batch distill job | PII corpus |
| 61–68 | knowledge ingest chain (one PR per story) | E4.F1.S1–S8 | M–L | knowledge | v1 knowledge importer in 68 | sync idempotence, swap atomicity |
| 69–74 | retrieval + ACL + pinning + reranker slot | E4.F2.S1–S6 | M–L | knowledge, compiler | none | ACL adversarial, recall@k |
| 75–80 | MCP fleet + server facade | E6.F1.S1–S6 | M–L | toolbus/mcp | v1 config converter | fault matrix, hostile descriptions |
| 81–85 | workflows: schema, compiler, triggers, subruns, gates | E7.F1.S1–S5 | M–L | runtime/planner | v1 DAG/cron converters | durable suspend chaos |
| 86–88 | decomposer, reflection, critic nodes | E7.F2.S1–S3 | M | runtime/planner | task-planner retired | reflection simulation |
| 89–92 | eval: scorers, judge, bench, ledger+drift | E8.F1.S3, F2.S1–S4 | M | control-plane/eval | judge pinned in config | agreement audits |
| 93 | experiments + guarded rollout | E8.F2.S5 | L | eval, gateway | traffic-split flag | auto-rollback sim |
| 94–98 | dashboard: framework, core views, inbox, inspector, cost | E9.F1.S1–S5 | M–L | control-plane/readmodels, web | v1 endpoints aliased | projector replay |
| 99–102 | dashboard quality views + RBAC | E9.F2.S1–S4 | M | readmodels, web | — | RBAC matrix |
| 103–105 | sandbox tiers, selection, breaker, streaming tools | E5.F2.S1–S4 | M–L | toolbus | — | escape suite |
| 106–111 | control plane: registry, policy, tenancy, limits, SSO, audit | CP.S1–S6 | L | control-plane, substrate | RLS enable = migration + verify | cross-tenant adversarial |
| 112–115 | SDK: OpenAPI, TS L1–L2, CLI refactor [REFACTOR], L3 | E10.F1.S1–S4 | L | sdk, cli | CLI aliases preserved | e2e suites |
| 116–118 | plugin-kit + channel extraction + remaining extraction | E10.F2.S1–S3 | L | sdk, plugins | kernel drops plugin imports | parity smoke |
| 119–121 | Python/Go clients+toolkits, examples+quickstart | E10.F3.S1–S3 | M–L | sdk | — | recipes in CI |

---

## 5. Sprint, Milestone, Release Plans

2-week sprints, 5–6 eng. Sprint allocation (indicative — re-plan at phase gates):

| Sprint | Focus | Exit criteria |
|---|---|---|
| 1 | PRs 1–8 (Phase 1) | Phase-1 acceptance (cache >60%, goldens captured) |
| 2–3 | PRs 9–18 (foundations, substrate) ◆A | contract suites green both engines |
| 4–5 | PRs 19–27 (gateway) ◆B ∥ PRs 28–33 (toolbus) | v1 integration suite via shim |
| 6–8 | PRs 34–46 (executor→cutover) ◆C ◆D ∥ 47–48 | golden parity ≥98%; cutover flag live |
| 9–10 | PRs 49–60 (compiler ◆E, memory) | long-session token ↓≥50% vs baseline |
| 11–14 | PRs 61–93 four parallel lanes (knowledge ◆F, MCP, planner ◆G, eval) + 94–98 | Phase-4 acceptance per blueprint |
| 15–16 | PRs 99–111 (dashboard done, control plane, tenancy ◆H) | pentest pass; RBAC green |
| 17–19 | PRs 112–121 (SDK, plugins ◆I, DX) | quickstart ≤15 min; plugins pass harness |
| 20 | hardening, docs, release | v2.0.0 checklist |

**Version tags:** `v1.25.x` Phase-1 items on current line (maintenance continues until cutover) · `v2.0.0-alpha` = ◆D (sprint ~8) · `v2.0.0-beta` = Phase-4 exit (sprint ~14) · `v2.0.0-rc` = ◆H + ◆I (sprint ~19) · `v2.0.0` = sprint 20 · `v2.1` = plugin-ecosystem release (post-GA backlog).

---

## 6. Risk Register

| # | Risk | Prob | Impact | Owner | Mitigation / trigger |
|---|---|---|---|---|---|
| R1 | Golden parity <98% at ◆C | M | program delay | Kernel A | triage protocol: classify diffs (bug vs acceptable drift); acceptable drift re-goldens with review; hard bugs block cutover |
| R2 | Checkpoint overhead >15ms p95 | M | latency regression | Kernel A | delta encoding tuning; ckpt batching per node group; gate at E1.F1.S3 |
| R3 | Summary/window degrades long-session quality | M | user-visible | Kernel B | raw log retained; long-session eval set; flag rollback |
| R4 | Parallel Phase-4 lanes drift | H | integration pain | TPM | weekly integration train mandatory; lane PRs rebase on train |
| R5 | Tenancy isolation flaw | L | severe | Floating senior | adversarial suite + external pentest before rc; RLS default-deny |
| R6 | Judge scorer unreliable | M | false gates | Floating senior | structural checkers primary; judge advisory until agreement audit passes |
| R7 | Plugin extraction breaks channel users | M | churn | DX | first-party plugins are compat suite; parity smoke per channel |
| R8 | MCP spec change mid-program | M | rework | Tools mid | CompatLayer isolates; pin supported versions |
| R9 | Team size below 5 | M | timeline +40% | TPM | critical path protected first; Phase-4 lanes serialized as fallback |
| R10 | Scope creep via "small additions" | H | drift from blueprint | All | rule: not in backlog → needs ADR; TPM enforces |

---

## 7. Architecture Compliance Checklist (apply per PR review)

- [ ] Imports comply with §1 package table (dep-cruiser green — automated)
- [ ] New behavior behind flag if it changes existing behavior
- [ ] Ports defined in `contracts`, impls in owning package; no cross-package concrete imports
- [ ] Untrusted content (tool/MCP/retrieved/channel) provenance-tagged before context entry
- [ ] Any model call goes through Model Gateway (no direct SDK usage — lint rule)
- [ ] Any tool execution goes through Tool Bus (incl. MCP)
- [ ] Context construction only via Context Compiler; no string-concat prompts outside it
- [ ] State mutations produce events; consumers idempotent
- [ ] Checkpoint-affecting changes preserve resume compatibility or version the codec
- [ ] Prompt/workflow/KB artifacts content-hashed and registered
- [ ] Memory writes only via MemoryManager.propose (Learn node / user command)
- [ ] Secrets never in context, logs, or checkpoints (redaction test present)
- [ ] Metrics + spans added for new operations
- [ ] No empty catch; errors logged or rethrown typed

**Violation scan of this backlog:** none found. Two watch-items flagged: (1) E1.F3.S2 pulls an Epic-8 story early — acceptable, harness lives in eval package from day one; (2) E5.F1.S7 gated builtins depend on sandbox (E5.F2.S1) — ordering enforced in dependency graph; do not ship shell/exec builtins before sandbox lands.

---

**Stop point.** Backlog complete, implementation-ready. Next instruction can name a story (`E0.F1.S1`) or PR (#9) and execution proceeds without redesign.
