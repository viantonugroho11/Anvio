# Hermes vNext — Master Implementation Blueprint

> **⚠️ DEPRECATED — DO NOT EXECUTE.**
> This greenfield/vNext plan is superseded by [architecture-evolution-ledger.md](architecture-evolution-ledger.md).
> The current repository is the product; all changes follow the evolutionary (KEEP/EXTEND/REFACTOR) doctrine.
> Kept for reference only: design rationale and rejected alternatives remain useful reading.


**Status:** DEPRECATED (superseded by architecture-evolution-ledger.md)
**Date:** 2026-07-10
**Predecessors:**
- [architecture-review-vnext.md](architecture-review-vnext.md) — *Review* (current-state findings)
- [architecture-vnext-design.md](architecture-vnext-design.md) — *Design* (target architecture; §refs point there)

**Reading guide.** Each epic follows one template: Purpose & Gap → Target Architecture (components, modules, interfaces, folders, dependencies) → Flows (sequence, data, events) → Cross-cutting (DB, config, security, observability/metrics) → Delivery (testing, migration, milestones, risks, trade-offs, complexity, timeline, team, deliverables) → Justification (why / gains). Shared conventions are defined once in §0 and not repeated per epic.

---

## 0. Shared Conventions (apply to every epic)

**Architecture style.** Hexagonal per Design §2: ports in `kernel/contracts`, adapters in `kernel/substrate` or the owning gateway. DI via constructor injection with a tiny composition container (no decorator framework — NestJS stays confined to `surfaces/api`). CQRS applied only where read/write shapes diverge materially (Registry, Eval, Dashboard read models); everywhere else plain services. All cross-component notification via the Event Bus (`hermes.<domain>.<verb>` subjects, CloudEvents envelope, at-least-once, idempotent consumers).

**Interfaces.** All public interfaces below are TypeScript ports in `kernel/contracts`, zod-schema'd at boundaries. Names given as `PortName.method(args): result` shorthand — signatures indicative, not code.

**Persistence.** Single migration framework, dual dialect (SQLite WAL / Postgres) per Design §18. Every table carries `tenant_id`, `created_at`; content-addressed artifacts in CAS. DB changes listed per epic are additive tables — no epic mutates another epic's tables.

**Security baseline.** Every gateway enforces: tenant scoping, policy check before effect, secrets never in context/logs, provenance tags on untrusted data (Design §16). Epic sections list only *additional* concerns.

**Observability baseline.** OTel spans per operation, structured pino logs, metrics via one registry (Design §19). Epic sections list only domain-specific metrics.

**Testing baseline.** Unit tests colocated; contract-test suite runs each port against all implementations; golden-trajectory replay in CI from Epic 8 onward. Coverage gate: new kernel code ≥80% line, hot paths ≥90%.

**Estimation basis.** 1 engineer-week (ew) = 1 senior engineer, focused. Timelines assume the team in §PM. Complexity: S (<1 ew), M (1–3 ew), L (3–8 ew), XL (>8 ew).

---

## Epic 1 — Runtime Engine

### 1.1 Purpose & Current Gap

Purpose: durable, streaming, cancellable, resumable agent execution — the kernel's heart.
Gap (*Review §2*): 409-line untested generator; approval-only checkpoints; no abort propagation; per-turn skill-catalog rescan; 5-iteration ceiling as philosophy; silent catches; no worker fairness.

### 1.2 Target Architecture

Graph executor per Design §4. Components:

| Component | Responsibility |
|---|---|
| `GraphExecutor` | walks node graph, persists checkpoint after each node, owns run status machine |
| `NodeKit` | standard nodes: intake, compile-context, model, route, tool-exec, approval-wait, reflect, finalize, learn |
| `RunStateStore` | checkpoint CRUD (delta-encoded, CAS refs for large payloads) |
| `CancellationController` | AbortSignal tree: run → node → gateway → HTTP |
| `RetryPolicy` | per-node-class policy: model (fallback chain owns retry), tool (per-tool policy), transient infra (jittered exp backoff, max 3) |
| `ApprovalCoordinator` | suspend/resume protocol, expiry timers, decision injection |
| `WorkerPool` | queue consumer; per-tenant concurrency fairness; heartbeat + orphan-run recovery |
| `RunEventPublisher` | streams deltas/status to Event Bus topics `run.<id>.*` |

Internal modules: `graph/` (executor, node contract, edge routing), `state/` (checkpoint codec, delta encoding), `lifecycle/` (status machine: `queued→running→{suspended,completed,failed,cancelled}`), `workers/` (pool, lease, recovery), `standard-graph/` (the shipped ReAct+ graph and its parameterization).

Public interfaces:

- `RunService.start(agentRef, sessionId, input, opts): RunHandle`
- `RunService.resume(runId, signal: ApprovalDecision | UserInput | TimerFire)`
- `RunService.cancel(runId, reason)`
- `RunHandle.events(): AsyncIterable<RunEvent>` (deltas, node transitions, usage, suspension)
- `GraphNode.execute(ctx: NodeContext): NodeOutcome` — `NodeOutcome = advance | suspend(reason) | fail | finish`
- `NodeContext` exposes: run state (typed), gateways (model/tool/knowledge), budget, abort signal, event emitter — the only capability surface a node sees.

Folder: `kernel/runtime/{graph,state,lifecycle,workers,standard-graph,nodes}/`.
Dependencies: contracts, substrate (state/queue/event), model-gateway (E-gate: interface only until Epic 2/12 land — mock behind port), tool-bus, telemetry.

### 1.3 Flows

Sequence (standard turn):

```
Surface → RunService.start
  → enqueue → WorkerPool lease → GraphExecutor
    → intake ✓ckpt → compile-context ✓ckpt → model (stream deltas→bus) ✓ckpt
    → route: tool calls?
        yes → tool-exec (parallel, policy-gated) ✓ckpt → compile-context (loop)
        approval-needed → ApprovalCoordinator.suspend ✓ckpt → [return]
        no  → finalize ✓ckpt → learn(async) → run.completed
Approval decision → RunService.resume → executor rehydrates ckpt → continues at route
```

Data flow: input → typed RunState (message log + node cursor + usage + working memory) → checkpoint deltas → finalize persists session message. Event flow: `run.started/ node.entered/ delta/ tool.called/ run.suspended/ run.resumed/ run.completed|failed|cancelled`.

### 1.4 Cross-cutting

DB: `runs`, `run_checkpoints(run_id, seq, delta_blob_ref, node)`, `run_events(append-only, optional retention)`, `approvals(run_id, request, expires_at, decision)`.
Config: `runtime.maxIterations` (default 24 — raised from 5; Claude-Code-class tasks need headroom), `runtime.checkpointRetention`, `runtime.worker.concurrencyPerTenant`, per-agent overrides in frontmatter.
Security: nodes receive capability-scoped `NodeContext` only — no ambient imports of gateways; approval-wait enforces tainted-turn rule (Design §16).
Metrics: run duration histogram, node latency per type, checkpoint size/write latency, suspension count + approval latency, orphan recoveries, cancellation latency (signal→HTTP-abort).

### 1.5 Delivery

Testing: node contract tests with fake gateways; executor property tests (crash at any node → resume equivalence); golden replay of v1-recorded trajectories (Phase-0 capture) through standard graph; chaos test: kill worker mid-run, assert recovery.
Migration: v1 `DefaultAgentRuntime` behavior reproduced by standard graph; v1 approval checkpoints converted by importer to universal checkpoints; v1 runtime kept behind `runtime.engine: legacy|graph` flag for one minor release.
Milestones: **M1.1** executor + checkpoint/resume + standard graph minus tools (2 ew) → **M1.2** tool loop + parallel calls + cancellation tree (2 ew) → **M1.3** approval suspend/resume + worker pool + recovery (2 ew) → **M1.4** golden-replay parity gate + legacy flag (1 ew).
Risks: checkpoint overhead (mitigate: delta encoding, measure at M1.1 gate — budget <15ms p95 local); parity gaps vs v1 semantics (mitigate: golden replay is the gate, not review).
Trade-offs: graph indirection vs loop simplicity — accepted for testability/durability (Design §4 rationale); universal checkpoints cost storage — bounded by retention config.
Complexity XL. Timeline: 7 ew. Team: 2 senior (1 executor/state, 1 nodes/workers).
Deliverables: kernel/runtime package, standard graph, worker binary mode, golden-replay harness hook, ADR-0011 (graph executor), migration importer.

Why/Gains: unlocks every other epic (compiler, planner, eval all plug into nodes); durability = zero lost work on crash (operational); testable loop ends the highest-risk coverage gap; cancellation fixes real user pain. Token/cost effect: indirect (enables Epic 2). Perf: parallel tool calls cut multi-tool turns ~40–60% wall-clock. DX: nodes are the extension point everything else uses.

---

## Epic 2 — Prompt Engine

### 2.1 Purpose & Current Gap

Purpose: deterministic, budgeted, cached, versioned construction of every model request.
Gap (*Review §3–4*): string concatenation; no versioning/hash trail; no budget; no caching; all tool schemas always; unbounded history.

### 2.2 Target Architecture

Context Compiler + Prompt Registry per Design §7.

| Component | Responsibility |
|---|---|
| `PromptRegistry` | content-addressed prompt artifacts (persona, skill text, platform header, templates); version lineage; CQRS read model for dashboard |
| `ContextCompiler` | segment collection → priority/budget allocation → cache-aware ordering → provider-shaped request + **ContextManifest** |
| `TokenBudgetManager` | model-descriptor-derived budget; reserve output; allocation ledger per segment; degradation ladder |
| `SegmentProviders` | pluggable sources: persona, skills, tools (from Tool Bus selection), memory lanes, knowledge, history window |
| `HistoryWindower` | sliding window + rolling summary (summarizer via cheap route) |
| `TemplateEngine` | logic-less interpolation + conditionals; no loops/expressions |
| `PromptValidator` | schema, token ceiling, forbidden-content lint, must-contain assertions |
| `CompressionPass` | optional: whitespace/normalization on stable segments; summary-replace on history overflow |

Prompt strategy layers (explicit, ordered): platform header (kernel-owned, stable) → developer/persona (agent version) → skills → tool schemas → dynamic (memory/knowledge, provenance-framed) → history → user input. Each layer = segment with fixed priority class; cache breakpoints after the last stable segment (Design §7 table).

Public interfaces:

- `ContextCompiler.compile(req: CompileRequest): {providerRequest, manifest: ContextManifest}`
- `ContextManifest`: ordered `{segmentId, promptHash, tokens, cacheHint, provenance}` — persisted with checkpoint
- `PromptRegistry.put(artifact): PromptVersion(hash)` / `.get(hash)` / `.lineage(name)`
- `TokenBudget.allocate(segmentClass, requested): granted`
- `SegmentProvider.provide(ctx): Segment[]` — the plugin seam

Folder: `kernel/runtime/compiler/{registry,budget,segments,window,template,validate}/`. (Compiler lives inside runtime package — it is a node's engine, not a service.)
Dependencies: contracts, substrate (CAS), model-gateway (descriptors), tool-bus (selection), memory/knowledge ports.

### 2.3 Flows

Sequence: compile-context node → gather segments (parallel) → validate → budget-allocate by priority (drop/summarize lowest first) → order for cache stability → place cache breakpoints → emit request + manifest → manifest into checkpoint. Events: `prompt.compiled` (hashes, token counts), `prompt.budget.degraded` (what was dropped — never silent).

### 2.4 Cross-cutting

DB: `prompt_artifacts(hash, kind, meta)` (CAS-backed), `prompt_lineage(name, version, hash, parent_hash)`. Manifests live in checkpoints.
Config: `prompt.maxHistoryMessages`, `prompt.summarizeOnOverflow`, `prompt.reservedOutputTokens`, per-agent `contextBudget` overrides.
Security: provenance framing applied here — single enforcement point for data-not-instructions wrapping.
Metrics: tokens per segment class (histogram), cache-eligible ratio, cache hit ratio (fed back from gateway), degradation events, compile latency.

### 2.5 Delivery

Testing: compiler is pure given segment inputs → exhaustive unit tests; budget property tests (never exceeds window; priority order preserved); snapshot tests of manifests; prompt tests (must-contain/ceiling) wired into registry CI.
Migration: v1 `assembleSystemPrompt` output reproduced as segment set (parity snapshot test); v1 sessions gain manifests from first vNext turn onward.
Milestones: **M2.1** registry + hashing + manifest (1 ew) → **M2.2** compiler + budget + window/summary (2 ew) → **M2.3** cache-aware ordering + breakpoints + degradation ladder (1 ew) → **M2.4** validator + prompt tests in CI (1 ew).
Risks: summary quality degrades long-session coherence (mitigate: keep raw history in store; summary is view-only; eval set of long sessions); cache-order constraints fight priority order (resolve: stability wins for stable classes, priority governs dynamic tail).
Trade-offs: logic-less templates limit power — accepted, conditional structure belongs in compiler (Design §7).
Complexity L. Timeline: 5 ew. Team: 1 senior + 1 mid.
Deliverables: compiler + registry, manifest persistence, prompt-test CI harness, ADR-0012 (context compilation).

Why/Gains: **largest cost lever in the program.** With Epic 12 caching: 60–90% discount on stable prefix ≈ 40–70% blended input-token cost cut; window bounds worst-case context (fixes overflow crashes); manifests unlock Epic 8 attribution. Token saving: 50–80% long sessions (per Review §4 estimate). DX: reproducible prompts, diffable versions.

---

## Epic 3 — Memory Engine

### 3.1 Purpose & Current Gap

Purpose: typed, ranked, expiring memory that adds recall value per token spent.
Gap (*Review §5*): raw-turn mirroring into long-term JSON arrays; O(all-users) session scans; 500-entry keyword index; no TTL/decay/ranking; whole-file rewrite races.

### 3.2 Target Architecture

Three lanes per Design §8: episodic, semantic, procedural (procedural = skill registry, owned by learning; this epic ships the store + episodic + semantic).

| Component | Responsibility |
|---|---|
| `MemoryManager` | facade: write proposals in, ranked recall out; lane routing |
| `LaneStore` (×lane) | typed persistence: SQLite FTS5+vec / Postgres pgvector |
| `Distiller` | Learn-node consumer: session → episodic summary; facts → semantic entries (dedupe, contradiction check via cheap model) |
| `RecallPipeline` | query → hybrid search per lane → score (`relevance × recency-decay × type-weight × confidence`) → budget-capped selection |
| `ExpiryService` | TTL sweep, supersession (new fact replaces old, lineage kept), compaction of stale episodic entries |
| `MemoryEvaluator` | recall-quality eval hooks (needle tests, precision on labeled sets) — feeds Epic 8 |

Working memory: run-checkpoint scratchpad (Epic 1), not here. Conversation/session memory: session log + HistoryWindower (Epic 2), not here. This separation is load-bearing — v1 conflated them.

Public interfaces:

- `MemoryManager.propose(writes: MemoryProposal[]): Applied[]` (policy-gated; only Learn node + explicit user command may write)
- `MemoryManager.recall(query, scope{user,project,agent}, budgetTokens): RankedMemory[]`
- `MemoryManager.forget(selector): count` (user-facing delete; GDPR path)
- `LaneStore` port for plugin stores (Honcho delegate becomes a plugin impl)

Folder: `kernel/runtime/memory/{manager,lanes,distill,recall,expiry}/` + substrate store impls.
Dependencies: contracts, substrate, model-gateway (distillation via cheap route), telemetry.

### 3.3 Flows

Write: `run.completed` event → Learn node → Distiller → proposals → policy gate → lane stores → `memory.written`. Read: compile-context node → `recall(query=current input + session topic, budget from Epic 2)` → segments with provenance. Expiry: scheduled workflow (Epic 7 timer) → sweep → `memory.expired`.

### 3.4 Cross-cutting

DB: `memory_entries(lane, tenant, user, project, content, embedding?, confidence, provenance_run, ttl_at, superseded_by)`, FTS + vector indexes.
Config: per-lane TTL defaults, `memory.recallBudgetTokens`, type weights, `memory.pii.policy: block|redact|allow`.
Security: PII detector hook at write; delete-by-user API; provenance on every recalled item (user can ask "why do you know this").
Metrics: entries per lane, recall latency, recall precision (eval), tokens injected vs used (did model reference it — heuristic), expiry counts.

### 3.5 Delivery

Testing: lane-store contract tests (both engines); recall ranking golden sets; distiller output schema tests; needle-in-haystack recall evals.
Migration: importer distills v1 `memory/*.json` conversation blobs into episodic summaries (batch LLM job, cheap route) + drops raw mirrors; v1 recall index discarded.
Milestones: **M3.1** stores + manager + recall (SQLite) (2 ew) → **M3.2** distiller + write policy + expiry (1.5 ew) → **M3.3** Postgres impls + importer + PII hook (1.5 ew).
Risks: distillation cost on busy tenants (mitigate: batch lanes Epic 12; sample low-value sessions); contradiction-check false positives (mitigate: supersede-don't-delete, lineage kept).
Trade-offs: LLM-mediated writes add latency/cost off critical path — accepted; raw-mirror writes were free but worthless.
Complexity L. Timeline: 5 ew. Team: 1 senior + 1 mid (shared with Epic 4 — same retrieval substrate).
Deliverables: memory package, importer, recall eval set, ADR-0013 (memory lanes).

Why/Gains: recall becomes useful instead of decorative; token saving ~5–15% (stop injecting junk; budget-capped); privacy compliance unlocked (enterprise gate); storage cost down (no raw mirrors).

---

## Epic 4 — Knowledge Engine

### 4.1 Purpose & Current Gap

Purpose: versioned ingestion + hybrid retrieval with measured quality.
Gap (*Review §6–9*): ingest = file copy; full re-process every sync; no chunking/embedding/retrieval; no freshness; no permissions.

### 4.2 Target Architecture

Pipeline per Design §9–10:

| Component | Responsibility |
|---|---|
| `KnowledgeRegistry` | KBs, versions (snapshot = set of doc versions), source configs, permissions |
| `Connector` (plugin port) | files, git, web, Confluence, GitHub, DB → canonical doc model |
| `SyncEngine` | content-hash diff → changed docs only; scheduled/webhook-triggered; resumable batches on queue |
| `Chunker` | structure-aware (headings/AST), parent-child links |
| `Enricher` | contextual headers (LLM, batch lane), metadata extraction |
| `Indexer` | two-phase generation build + atomic swap; embedding-version stamped |
| `Retriever` | hybrid BM25+vector, RRF fusion; metadata filters; parent expansion; dedup; budget-capped compression |
| `Reranker` (plugin slot) | optional cross-encoder |
| `RagEvaluator` | retrieval eval sets (recall@k, faithfulness sampling) — feeds Epic 8 |

Public interfaces:

- `Knowledge.query(kbRef@version?, query, filters, budgetTokens): SourcedPassage[]`
- `Knowledge.sync(kbRef): SyncReport` / `Knowledge.snapshot(kbRef): KbVersion`
- `Connector.list(): DocRef[]` + `.fetch(ref): CanonicalDoc` — plugin seam
- Permissions: `kb.grant(subject, kb, read|write|admin)`; retrieval enforces per-doc ACL inherited from source where connector supplies it

Folder: `kernel/knowledge/{registry,connectors,sync,chunk,enrich,index,retrieve,eval}/`.
Dependencies: contracts, substrate (CAS, queue, search/vector stores), model-gateway (embed/enrich via batch), telemetry.

### 4.3 Flows

Ingest: trigger → SyncEngine hash-diff → changed docs → chunk → enrich (batch) → index gen N+1 → eval smoke (recall on canary queries) → swap → `kb.version.published`. Query: compile-context → `Knowledge.query` (agent's bound KB@pinned-version) → passages, provenance-tagged → compiler budget.

### 4.4 Cross-cutting

DB: `kbs`, `kb_versions`, `documents(hash, source_ref, version, valid_from/to, acl)`, `chunks(doc, parent, meta, embedding_gen)`, index-generation bookkeeping.
Config: per-KB: sources, chunk params, embedding model, sync schedule, freshness TTL; per-agent KB bindings (optionally version-pinned).
Security: doc-level ACL filter *inside* retrieval (never post-filter in context); retrieved content provenance-framed (RAG-injection defense).
Metrics: sync durations, docs changed/skipped, index build time, retrieval latency, recall@k on eval sets, staleness age distribution, % queries hitting reranker.

### 4.5 Delivery

Testing: connector contract tests with fixture corpora; chunker golden snapshots; retrieval eval harness with labeled query sets per KB type (docs, code); two-phase-swap atomicity test.
Migration: v1 `knowledge/raw` dirs import via file connector; wiki copies discarded; manifest → registry entries.
Milestones: **M4.1** canonical model + file/git connectors + hash sync (2 ew) → **M4.2** chunker + FTS/BM25 retrieval (Level-1 floor) (2 ew) → **M4.3** embeddings + hybrid + parent-child + two-phase index (2 ew) → **M4.4** enrichment + eval harness + Confluence/web connectors (2 ew).
Risks: retrieval quality disappoints without evals (mitigate: eval harness ships in M4.4 *before* GA; BM25 floor always available); connector sprawl (mitigate: plugin seam, community-ownable).
Trade-offs: contextual enrichment adds ingest cost (~1 cheap-model call/chunk, batch-discounted) for measured retrieval gains; knowledge graph deferred (plugin slot).
Complexity XL. Timeline: 8 ew. Team: 2 (1 senior pipeline, 1 mid connectors/eval).
Deliverables: knowledge package, 4 connectors, eval harness + labeled sets, ADR-0014 (RAG baseline).

Why/Gains: turns "knowledge" from stub into product capability; hallucination reduction on doc-grounded tasks (measured by faithfulness evals); incremental sync cuts re-index cost to Δ-only; enterprise gate (Confluence + ACL).

---

## Epic 5 — Tool Engine

### 5.1 Purpose & Current Gap

Purpose: one governed bus for all tool execution.
Gap (*Review §10–11*): boolean enable flags; no timeout/retry/circuit-breaker; all schemas every turn; unbounded outputs; mutable shared context (`mergeContext`); no audit/metrics per tool.

### 5.2 Target Architecture

Tool Bus per Design §11:

| Component | Responsibility |
|---|---|
| `ToolRegistry` | tool metadata: name, version, category, schema, policy defaults, provider (builtin/MCP/plugin) |
| `PolicyGate` | per-call: scope, approval class, rate limit, tenant policy, tainted-turn rule |
| `Resolver` | name → executor binding; version pinning per agent |
| `Executor` | timeout, retry (per-policy), circuit breaker per tool, sandbox tier dispatch (none/process/container via Sandbox service), parallel independent calls |
| `OutputGovernor` | token-budget clip (head/tail), full payload → CAS blob + `read_artifact` reference |
| `SelectionService` | per-turn relevant-schema set: declared ∪ route-matched ∪ recently-used; `tool_search` meta-tool for the long tail |
| `StreamingAdapter` | long-running tools: progress events to run stream; heartbeat; detachable (tool continues, run suspends on `event-wait`) |
| `ToolAuditor` | immutable audit record per call (input hash, output hash, actor chain, policy verdicts) |

Public interfaces:

- `ToolBus.execute(calls: ToolCall[], ctx: CallContext): ToolResult[]` (parallelizes internally)
- `ToolBus.schemas(selection: SelectionHint): ModelToolDefinition[]`
- `ToolProvider.register(descriptor, executor)` — plugin seam (builtins, MCP via Epic 6, plugins)
- `ToolPolicy = {enabled, scope, approval: auto|ask|deny, timeoutMs, retries, rateLimit, sandbox, outputBudgetTokens}` — declarative, layered (default → tenant → project → agent)

Folder: `kernel/tool-bus/{registry,policy,exec,govern,select,audit,builtins}/`.
Dependencies: contracts, substrate (CAS, secrets), sandbox service, telemetry. Epic 6 plugs in as a ToolProvider.

### 5.3 Flows

Sequence: model tool_calls → route node → `ToolBus.execute` → per call: PolicyGate (deny → synthetic error result; ask → suspend signal up to executor) → Executor (breaker check → sandbox dispatch → timeout race) → OutputGovernor → Auditor → results to compile-context. Events: `tool.called/succeeded/failed/denied/breaker.opened`.

### 5.4 Cross-cutting

DB: `tool_registry`, `tool_audit(call_id, tool, version, in_hash, out_hash, verdicts, latency)`, breaker state in cache tier.
Config: policy layers in `hermes.yaml` + agent frontmatter; builtin pack enable-sets ("safe-default", "coding", "browser").
Security: this epic *is* the tool-security enforcement point; secrets injected at execution env, never through model context; shell/write tools default `approval: ask`; sandbox mandatory for `run_shell`/`execute_code` in server mode.
Metrics: per-tool latency/error/timeout histograms, breaker state changes, denials by reason, output-clip ratio, schema tokens offered per turn.

### 5.5 Delivery

Testing: policy-gate decision-table tests (exhaustive); breaker/timeout fault-injection; governor property tests (never exceed budget, artifact always retrievable); audit completeness invariant (every execute → exactly one audit row).
Migration: v1 gateway YAML auto-converts (boolean → policy object with defaults); 73 builtins port mechanically onto ToolProvider (bulk, low-risk); `mergeContext` mutable pattern eliminated by CallContext immutability.
Milestones: **M5.1** registry + policy + executor + governor (2 ew) → **M5.2** builtins port + selection service + audit (2 ew) → **M5.3** breaker/streaming/long-running + sandbox tiers (2 ew).
Risks: selection service hides a needed tool (mitigate: `tool_search` meta-tool always present; miss-rate metric); builtin port regressions (mitigate: v1 tool spec tests carried over + golden replay).
Trade-offs: policy indirection on every call (~sub-ms) for governance — trivial vs LLM latency.
Complexity L–XL. Timeline: 6 ew. Team: 1 senior + 1 mid.
Deliverables: tool-bus package, ported builtin packs, policy converter, ADR-0015 (tool policy model).

Why/Gains: schema-token cut 60–80% steady-state (with Epic 2); output governance removes context-poisoning class; audit/metrics = enterprise gate; parallel execution wall-clock win (with Epic 1).

---

## Epic 6 — MCP Gateway

### 6.1 Purpose & Current Gap

Purpose: production-grade MCP client fleet + Hermes-as-MCP-server.
Gap (*Review §10*): registry exists; no health checks, connection pooling, version compat handling, per-server auth lifecycle, tracing.

### 6.2 Target Architecture

| Component | Responsibility |
|---|---|
| `McpRegistry` | server configs per tenant/project: transport, auth, trust tier, catalog cache TTL |
| `ClientManager` | connection lifecycle: lazy connect, pool (streamable-HTTP), stdio process supervision, backoff reconnect |
| `AuthBroker` | OAuth flows via control plane; token storage in secrets; refresh; per-user vs per-workspace identity |
| `CatalogService` | tool/resource/prompt discovery → normalized descriptors → ToolRegistry (Epic 5) with `mcp:` provenance |
| `HealthMonitor` | ping/capability probes; unhealthy → tools withdrawn from selection + advisory event |
| `CompatLayer` | protocol version negotiation; graceful degradation of optional capabilities |
| `McpServerFacade` | Hermes-as-server: agents, memory.recall, knowledge.query exposed as MCP tools |

Public interfaces: `McpGateway` implements `ToolProvider` (Epic 5 seam) — the bus never knows MCP specifics. Plus `McpAdmin.add/remove/test(serverConfig)`, `McpAdmin.status(): ServerHealth[]`.

Folder: `kernel/tool-bus/mcp/{registry,client,auth,catalog,health,server}/` (sub-package of tool-bus — MCP is a tool provider, not a peer subsystem).
Dependencies: tool-bus, substrate (secrets, cache), control-plane (OAuth), telemetry.

### 6.3 Flows

Discovery: server added → connect → negotiate → catalog fetch → descriptors into ToolRegistry → `mcp.catalog.updated`. Call: ToolBus resolves `mcp:` tool → ClientManager lease → call with timeout/trace-context → result through OutputGovernor (Epic 5 — MCP output is untrusted). Health: probe loop → fail threshold → withdraw tools → `mcp.server.unhealthy`.

### 6.4 Cross-cutting

DB: `mcp_servers(tenant, config, trust_tier)`, catalog cache in cache tier.
Config: `mcp.servers[]` per project; trust tiers map to sandbox/approval defaults (untrusted server ⇒ tools default `approval: ask`).
Security: stdio servers out-of-process with resource caps + workspace-scoped FS views; OAuth tokens encrypted, never logged; server-supplied tool descriptions sanitized (description-injection defense) before entering schemas.
Metrics: per-server connect success, call latency/error, catalog staleness, health-state transitions, auth refresh failures.

### 6.5 Delivery

Testing: fake MCP server fixture (all transports); fault matrix (hang, malformed, mid-call disconnect, version mismatch); auth-refresh race tests.
Migration: v1 `integrations` MCP registry configs auto-convert; MCP-first call gate semantics preserved.
Milestones: **M6.1** client manager + catalog → ToolRegistry (1.5 ew) → **M6.2** auth broker + health + compat (1.5 ew) → **M6.3** Hermes-as-server facade (1 ew).
Risks: MCP spec evolution (mitigate: CompatLayer isolates protocol version; track spec releases); stdio server zombie processes (mitigate: supervision + heartbeat kill).
Trade-offs: catalog caching vs freshness — TTL + invalidate-on-error.
Complexity M–L. Timeline: 4 ew. Team: 1 senior.
Deliverables: MCP provider, server facade, fixture server for CI, ADR-0016 (MCP trust tiers).

Why/Gains: reliability of the fastest-growing tool surface; interop moat (Hermes-as-server); description-injection defense closes real attack path.

---

## Epic 7 — Planner Engine

### 7.1 Purpose & Current Gap

Purpose: declarative workflows, goal decomposition, reflection — coordination above single runs.
Gap: v1 has separate `workflows` (DAG), `automation` (cron/hooks), `batch`, `task-planner` — overlapping, none checkpoint-durable, no reflection policy.

### 7.2 Target Architecture

One engine on the graph executor (Design §14): workflows compile to graphs.

| Component | Responsibility |
|---|---|
| `WorkflowRegistry` | versioned YAML workflow definitions (hash-versioned like prompts) |
| `WorkflowCompiler` | YAML → executor graph: step nodes (agent-run, tool, human-gate, timer, event-wait, sub-workflow), edges with conditions |
| `TriggerService` | cron, event subscriptions, webhooks → workflow starts (absorbs v1 automation) |
| `Decomposer` | goal → subtask plan via planner prompt (cheap/reasoning route by size); plan is working-memory state, revisable |
| `ReflectionPolicy` | when to enter reflect node: tool-error streak, guardrail flag, self-check cadence, eval-sampled; bounded attempts |
| `CriticNode` / `EvaluatorNode` | NodeKit additions: critique against rubric; score against checkers — reusable in workflows and standard graph |
| `SubRunManager` | typed spawn/await of child runs; fan-out with concurrency caps; result contracts (zod) |

Public interfaces: `Workflows.define(yaml): WfVersion` / `.start(ref@version, args): RunHandle` / `.signal(runId, event)`; `Planner.decompose(goal, ctx): Plan`; workflow step contract for plugin step types.

Folder: `kernel/runtime/planner/{workflows,compile,triggers,decompose,reflect,subruns}/`.
Dependencies: runtime (Epic 1 — it *is* graphs), contracts, event bus, control-plane scheduler.

### 7.3 Flows

Scheduled agent: cron trigger → workflow start → agent-run step (sub-run) → gate step (human approval — suspends whole workflow durably) → notify step → done. Reflection: tool-exec fails ×2 → policy trips → reflect node (critique prompt, cheap route) → revised approach or bounded give-up with structured failure. Multi-agent: supervisor workflow fans out N sub-runs (isolated contexts) → judge step consumes structured results.

### 7.4 Cross-cutting

DB: `workflows`, `workflow_versions(hash)`, `triggers(cron/event spec, workflow_ref)`; runs reuse Epic 1 tables (workflow instance = run).
Config: workflow YAML in `workflows/` dir (workspace) or registry (server); reflection policy per agent frontmatter.
Security: workflow definitions are code-equivalent — publish gated by policy; human-gate steps enforce approver roles; sub-runs inherit *intersected* permissions (never escalate).
Metrics: workflow duration/success, step retry counts, reflection trigger/success rates, decomposition depth, sub-run fan-out sizes.

### 7.5 Delivery

Testing: compiler golden tests (YAML → graph shape); durable-suspend tests (kill mid-workflow, resume across restart); reflection-policy simulation on recorded failures; sub-run contract violation tests.
Migration: v1 DAG YAML auto-converts; v1 cron/hooks map to TriggerService; `batch` becomes a fan-out template; v1 `task-planner` retired into Decomposer.
Milestones: **M7.1** compiler + core step types + triggers (2 ew) → **M7.2** sub-runs + fan-out templates + human gates (2 ew) → **M7.3** reflection policy + critic/evaluator nodes + decomposer (2 ew).
Risks: workflow YAML becomes a bad programming language (mitigate: step vocabulary fixed + plugin steps; loops only as bounded map/fan-out; anything harder → SDK custom graph); reflection loops burn tokens (mitigate: hard attempt caps + budget backpressure).
Trade-offs: no free-form agent chat (Design §14 rejection) — templates cover the defensible patterns.
Complexity L. Timeline: 6 ew. Team: 1 senior + 1 mid.
Deliverables: planner package, workflow template library, trigger service, ADR-0017 (workflow-as-graph).

Why/Gains: consolidates 4 v1 packages into 1 engine (maintenance ↓); durable scheduled agents = headline enterprise feature; bounded reflection measurably lifts autonomous-run success (track via Epic 8).

---

## Epic 8 — Evaluation Framework

### 8.1 Purpose & Current Gap

Purpose: measurement layer making every other epic's claims falsifiable.
Gap (*Review §15*): no evals of any kind; trajectory export exists unused.

### 8.2 Target Architecture

| Component | Responsibility |
|---|---|
| `GoldenStore` | curated trajectories, labeled retrieval sets, prompt assertions — versioned in CAS, reviewed like code |
| `ReplayHarness` | re-run trajectories against fake gateways (deterministic) or live models (benchmark mode) |
| `Scorers` (plugin seam) | rubric LLM-judge, exact/structural checkers, faithfulness sampler, trajectory-shape comparators |
| `EvalRunner` | suites: prompt / agent / tool / workflow / retrieval; CI mode (gate) + scheduled mode (drift) |
| `BenchService` | cost/latency/token benchmarks per model+prompt-version; model comparison matrices |
| `ExperimentService` | A/B: traffic-split at route or prompt-version level; guarded rollout with auto-rollback on score drop |
| `ScoreLedger` | scores attached to run + every hash in its ContextManifest → per-version quality series (CQRS read model) |

Public interfaces: `Eval.run(suiteRef, targetVersions): Report`; `Eval.gate(change): pass|fail` (CI); `Experiments.start(spec)`; `Scorer` plugin port.

Folder: `kernel/control-plane/eval/{goldens,replay,scorers,runner,bench,experiments,ledger}/` + repo-level `evals/` for golden content.
Dependencies: runtime (replay), model-gateway (judge calls, capture), telemetry, all manifests/hashes (Epics 2,4,7).

### 8.3 Flows

CI gate: PR touches persona → registry detects hash change → EvalRunner replays affected suites → score diff vs baseline → gate. Drift: nightly sampled live-run scoring → ledger → dashboard + alert on trend break. A/B: two prompt versions split 90/10 → ledger comparison → promote/rollback.

### 8.4 Cross-cutting

DB: `eval_suites`, `eval_reports`, `scores(target_hash, scorer, value, run_ref)`, `experiments`.
Config: suite definitions in `evals/`; gate policy per artifact kind (personas gated, skills advisory, etc.); judge model route pinned + version-locked (judge drift control).
Security: golden data may contain sensitive content — CAS encryption scope + access policy; judge prompts injection-hardened (scores structured, not free text).
Metrics: gate pass rate, suite runtime, judge cost, score trends per version, experiment exposure counts.

### 8.5 Delivery

Testing: scorers tested against labeled agreement sets (judge vs human); replay determinism tests; the framework tests itself via meta-suite.
Migration: Phase-0 v1 trajectory capture becomes the seed golden set — record ~50 representative sessions before any runtime change.
Milestones: **M8.1** goldens + replay + basic scorers + CI gate (2 ew) → **M8.2** retrieval/tool suites + bench service (1.5 ew) → **M8.3** ledger read model + drift sampling + A/B (2 ew).
Risks: judge unreliability (mitigate: structural checkers first-class, judge agreement audited quarterly, judge version pinned); golden staleness (mitigate: quarterly refresh ritual, staleness metric).
Trade-offs: eval cost is real spend — budgeted lane, sampled not exhaustive.
Complexity L. Timeline: 5.5 ew. Team: 1 senior (+ scorer contributions from every epic team).
Deliverables: eval package, seed golden set, CI gate, ADR-0018 (eval gating policy).

Why/Gains: converts vNext from claims to evidence; prevents prompt/model regressions reaching users (business impact: trust); enables model-swap decisions with data (cost lever: pick cheapest model that passes suite — often 3–10× cheaper).

---

## Epic 9 — Dashboard

### 9.1 Purpose & Current Gap

Purpose: operational + quality visibility for operators, developers, and finance.
Gap: v1 web app reads 3 overview endpoints; no cost/token/eval/trace views (*Review §14, §19*).

### 9.2 Target Architecture

Thin surface over CQRS read models — dashboards are queries, not subsystems (Design §19). Backend: `control-plane/readmodels` projecting from events + ledgers; frontend: `surfaces/web` (Next.js kept).

Views (one route each, shared filter bar: tenant/project/agent/time):

1. **System/Health** — subsystem lifecycle states, queue depth, worker liveness, provider/MCP health, error budgets.
2. **Runtime** — live runs (streaming), suspension queue, approval inbox (actionable), node-latency heatmap, failure drill-down → run inspector (replay from checkpoints + ContextManifests).
3. **Token/Cost** — spend by tenant/project/agent/model/segment-class; cache-hit savings; budget consumption + forecasts; waste flags (degradation events, clipped outputs).
4. **Model** — route volumes, fallback triggers, provider latency/error, per-model bench scores (Epic 8).
5. **Prompt** — version lineage, score series per hash, token footprint per segment, pending review gates.
6. **Memory** — lane sizes, recall precision trend, expiry activity, PII policy hits.
7. **Knowledge** — sync status/freshness, index generations, retrieval quality trends, stale-doc alerts.
8. **Workflow** — schedules, run history, step failure hotspots, trigger activity.
9. **Evaluation** — suite results, drift charts, experiment status, judge-agreement audits.
10. **Audit** — immutable event search: who/what/when across control-plane mutations, approvals, tool calls.
11. **Tracing** — embedded trace viewer (link out to Grafana/Jaeger in server mode; built-in minimal viewer local).

Public interfaces: read-model query API (`/v1/insights/*`), SSE for live views; every panel deep-links to the underlying runs/versions.

Folder: `kernel/control-plane/readmodels/` + `surfaces/web/app/(dashboard)/`.
Dependencies: telemetry, event bus, ledgers from Epics 1,2,5,8. **Hard rule:** read models only — dashboard never queries operational tables directly.

### 9.3–9.4 Flows & Cross-cutting

Events → projectors → read-model tables (idempotent, replayable from event log). DB: `rm_*` tables, rebuildable. Config: retention per read model; RBAC per view (finance sees cost, not transcripts). Security: transcript access is permissioned + audited; PII-redacted projections for non-privileged roles. Metrics: projector lag, query latency.

### 9.5 Delivery

Testing: projector replay determinism; view contract tests against seeded read models; RBAC matrix tests.
Migration: v1 web overview preserved as the System view's first panel; v1 endpoints aliased.
Milestones: **M9.1** read-model framework + System/Runtime/Approval inbox (2 ew) → **M9.2** Token/Cost + Model (1.5 ew) → **M9.3** Prompt/Eval/Knowledge/Memory (2 ew) → **M9.4** Audit/Tracing + RBAC polish (1.5 ew).
Risks: dashboard scope creep (mitigate: panels require existing read model; no bespoke queries); projector lag confusion (mitigate: staleness indicator on every panel).
Complexity L. Timeline: 7 ew. Team: 1 frontend + 1 mid backend.
Deliverables: read-model framework, 11 views, approval inbox, run inspector.

Why/Gains: run inspector is the developer-experience centerpiece (Cursor/Claude Code lesson — debugging *is* the product); cost dashboard = finance gate for enterprise; approval inbox operationalizes HITL.

---

## Epic 10 — SDK

### 10.1 Purpose & Current Gap

Purpose: programmable access to everything; CLI as first consumer proves completeness.
Gap: v1 has no public SDK; platform callable only via CLI/API.

### 10.2 Target Architecture

Per Design §22: **TypeScript full SDK; Python + Go as generated API clients + tool-server kits.** (Go added per requirement — client + tool-kit tier only; full Go runtime rejected: triple-runtime drift, no demand evidence. Revisit via RFC on demand.)

| Deliverable | Contents |
|---|---|
| `@hermes/sdk` (TS) | L1: `chat()` one-liner, streaming iterators. L2: sessions/runs/events/approvals, memory & knowledge query, workflow start/signal. L3: custom tools, custom nodes, custom graphs, provider adapters. Auth: API-key + OAuth device flow. |
| `@hermes/plugin-kit` (TS) | manifest schema, extension-point interfaces (Design §21 table), local test harness (spin ephemeral kernel with fakes), publish tooling |
| `hermes-client` (Python) | generated from OpenAPI + hand-written streaming/pagination ergonomics; eval-harness client |
| `hermes-toolkit` (Python/Go) | write tools as MCP servers with typed helpers — plugs into Epic 6 |
| `hermes-client` (Go) | generated client, streaming helpers |

Versioning: SDK semver decoupled from platform; API `/v1` stability contract; plugin API `experimental` tag until Phase 5 exit. DX: examples repo (10 canonical recipes), TS-doc generated reference, `create-hermes-plugin` scaffolder, 15-minute quickstart budget (measured — literally timed in onboarding tests).

Folder: `sdk/{typescript,plugin-kit,python-client,python-toolkit,go-client,go-toolkit}/` + `examples/`.
Dependencies: API surface (Epic 24 §Design), OpenAPI spec generated from contracts — single source of truth.

### 10.3–10.4 Flows & Cross-cutting

CLI refactors onto `@hermes/sdk` (completeness proof). Security: SDK auth flows only via control plane; scoped API keys (per-project, per-capability). Metrics: SDK version adoption via user-agent, deprecated-endpoint usage.

### 10.5 Delivery

Testing: SDK integration suite against ephemeral kernel; generated-client contract tests from OpenAPI; example recipes run in CI (living documentation).
Milestones: **M10.1** TS SDK L1–L2 + CLI refactor onto it (2.5 ew) → **M10.2** L3 + plugin-kit + scaffolder (2 ew) → **M10.3** OpenAPI gen + Python/Go clients + toolkits (2 ew) → **M10.4** examples + docs + quickstart timing gate (1 ew).
Risks: premature API freeze (mitigate: `/v1` locks only at Phase 5 exit; beta header before); plugin API churn breaking early adopters (mitigate: first-party plugins absorb churn first).
Complexity L. Timeline: 7.5 ew. Team: 1 senior + 1 mid (DX-minded).
Deliverables: 6 SDK packages, examples repo, scaffolder, API reference.

Why/Gains: ecosystem flywheel (plugins are the moat vs closed peers); CLI-on-SDK guarantees no second-class API; Python toolkit meets ML users without runtime fork.

---

## Implementation Plan — Five Phases

Dependency spine: **E1 → E2 → (E3,E5) → (E4,E6,E7) → E8 gates all → E9,E10 ride alongside.** Epic 8's seed capture must precede Epic 1 cutover (goldens recorded on v1).

### Phase 1 — Fund & Measure (on current repo; ≈ 4 ew, 2 eng)

*Objectives:* implement ADR-0010 in v1 (prompt caching, sliding window, output clipping); pino + OTel + token/cost metrics; capture ~50 golden trajectories; agent-loop tests on v1.
*Deliverables:* 40–70% input-cost cut live; baseline metric dashboards; golden seed set.
*Dependencies:* none. *Risks:* window summarization quality — flag-guarded rollout.
*Rollback:* every item flag-guarded (`memory.maxShortTermMessages: 0` restores old behavior).
*Acceptance:* cache-hit ratio >60% on sessions ≥3 turns; zero golden-behavior diffs with window off→on for ≤window-length sessions; cost dashboard shows attributed spend.
*DoD:* flags default-on in release; docs updated; ADR-0010 status → Accepted.

### Phase 2 — Kernel Foundations (≈ 10 ew calendar, 3–4 eng)

*Objectives:* contracts + substrate (SQLite-WAL/Postgres, CAS, queue, events, secrets); Model Gateway (Epic 12 of Design — providers ported, caching/breakpoints, metering); Tool Bus core (M5.1–5.2); Prompt Registry (M2.1).
*Deliverables:* v1 runtime calling vNext gateways via adapters — v1 users get policy/caching/metering before executor changes; data importer (sessions/memory → substrate).
*Dependencies:* Phase 1 metrics (to prove no regression). *Risks:* adapter impedance v1↔gateway — contract tests both sides.
*Rollback:* adapter flag per gateway (`gateway.model: legacy|vnext`).
*Acceptance:* all v1 integration tests green through adapters; importer checksums verified; per-tool policy enforced in production.
*DoD:* v1 direct-provider code deleted; substrate contract suite green on both engines.

### Phase 3 — Runtime Cutover (≈ 10 ew calendar, 3–4 eng)

*Objectives:* Epic 1 complete; Epic 2 complete (compiler + manifests); Epic 8 M8.1 (replay + CI gate) — **the gate for this phase's own cutover**; Epic 3 M3.1–3.2.
*Deliverables:* graph runtime default; universal checkpoints; ContextManifests on every call; memory lanes writing.
*Dependencies:* Phase 2 gateways; Phase 1 goldens. *Risks:* parity gaps (golden replay gate); checkpoint perf (M1.1 budget gate).
*Rollback:* `runtime.engine: legacy` flag retained one minor release.
*Acceptance:* golden replay ≥98% trajectory-equivalence; checkpoint overhead <15ms p95 local; resume-after-kill chaos suite green; long-session token spend ↓ ≥50% vs Phase-1 baseline.
*DoD:* legacy runtime removed next minor; run inspector shows manifests; Epic 3 importer executed.

### Phase 4 — Capabilities (≈ 12 ew calendar, 4–5 eng, parallel tracks)

*Objectives:* Epic 4 (knowledge), Epic 6 (MCP), Epic 7 (planner/workflows), Epic 5 M5.3, Epic 3 M3.3, Epic 8 M8.2–8.3, Epic 9 M9.1–9.2.
*Deliverables:* hybrid RAG with eval harness; MCP fleet mgmt + Hermes-as-server; durable scheduled workflows; approval inbox + cost dashboards.
*Dependencies:* Phase 3 runtime (workflows are graphs). *Risks:* parallel-track integration drift — weekly integration test train; retrieval quality — BM25 floor + eval gate before GA label.
*Rollback:* each capability independently flag-gated; KB versions pinnable to pre-migration snapshots.
*Acceptance:* retrieval eval baselines published; workflow durable-suspend chaos green; v1 automation/cron migrated with zero missed schedules; MCP fault matrix green.
*DoD:* v1 packages (knowledge, workflows, automation, batch, task-planner, integrations-MCP) deleted; docs regenerated.

### Phase 5 — Platform & Ecosystem (≈ 10 ew calendar, 4 eng)

*Objectives:* control plane completion (registry versioning/gates, tenancy/RLS, policy, audit); Epic 9 M9.3–9.4; Epic 10 all; plugin extraction (souls, kanban, goals, channels, voice → plugins); server-tier hardening (rate limits, spend budgets, SSO).
*Deliverables:* multi-tenant server mode GA; SDK GA; plugin API v1; `/v1` API frozen.
*Dependencies:* everything prior. *Risks:* plugin extraction breakage (first-party plugins are the compat suite); tenancy security (external pentest gate).
*Rollback:* plugins re-embeddable (in-process by default anyway); tenancy features off in local tier by construction.
*Acceptance:* RLS isolation verified by adversarial tests + external review; quickstart ≤15 min measured; all first-party plugins pass plugin-kit harness; eval gates mandatory on registry activations.
*DoD:* v1 repo archived; migration guide published; version 2.0.0 tagged.

---

## Project Management Artifacts

### ADRs to write (numbered continuation of v1's series)

0011 graph executor & universal checkpoints · 0012 context compilation & manifests · 0013 memory lanes & write policy · 0014 RAG baseline (hybrid, contextual enrichment, two-phase index) · 0015 tool policy model & output governance · 0016 MCP trust tiers · 0017 workflow-as-graph consolidation · 0018 eval gating policy · 0019 substrate & storage tiers (SQLite-WAL/Postgres, CAS) · 0020 modular monolith & sanctioned split points · 0021 tenancy via RLS · 0022 SDK language strategy · 0023 plugin capability grants · 0024 event envelope & delivery semantics.

### RFC list (design-before-build items needing team input)

RFC-1 NodeContext capability surface · RFC-2 checkpoint delta encoding · RFC-3 ContextManifest schema · RFC-4 workflow YAML step vocabulary · RFC-5 scorer plugin interface · RFC-6 plugin manifest & permission grammar · RFC-7 read-model projection framework · RFC-8 API resource model & pagination · RFC-9 judge-model governance · RFC-10 Go/Python toolkit ergonomics.

### Technical debt backlog (v1 items that must not port)

Silent `catch {}` (lint rule bans) · `mergeContext` mutable sharing · checkpoint `as unknown as` cast (zod-validated codec) · whole-file JSON rewrites · per-turn skill-catalog rescan · env-var ambient config · `tools/legacy.ts` + Hermes/Anvio naming split · phase-doc sprawl (52–59 archived) · 727-line composition root · micro-packages (souls/goals/personas/auth merge into plugin homes).

### Product backlog (post-2.0 candidates, unscheduled)

Semantic cache plugin · learned routing plugin · knowledge graph plugin · visual workflow builder · DSPy-style prompt optimizer on registry · voice-first surface revamp · fine-grained per-document redaction · marketplace for plugins/blueprints · on-prem air-gapped bundle.

### Sprint & release cadence

2-week sprints; each sprint ends with the integration test train + demo. Releases: minor monthly, patch as needed. Version roadmap: **v1.25–1.2x** = Phase 1 on current repo · **v2.0.0-alpha** = Phase 3 exit (graph runtime default) · **v2.0.0-beta** = Phase 4 exit · **v2.0.0** = Phase 5 exit · **v2.1** = first plugin-ecosystem release. Milestone board mirrors M-numbers above; every M has an owner and an acceptance test named in this doc.

### Team recommendation (steady state)

5–6 engineers: 2 senior kernel (runtime/compiler/gateways), 1 senior retrieval/memory, 1 mid tools/MCP/plugins, 1 frontend/DX (dashboard/SDK), 1 floating senior (eval + program glue). TPM function: 0.5 FTE (this doc is the plan of record; TPM tracks M-gates and risk register).

Total effort: ~61 epic ew + integration overhead ≈ **9–10 calendar months** at recommended staffing, with user-visible value shipping from Phase 1 (month 1).

---

## Quality Requirements Rollup (WHY, per program outcome)

| Outcome | Driver epics | Expected gain |
|---|---|---|
| Input-token cost | E2+E12(gateway)+E5 | 50–80% long sessions; 60–80% schema tokens; cache hits 60–90% stable prefix |
| Wall-clock latency | E1 (parallel tools), E12 (breakers/fallback) | 40–60% multi-tool turns; fewer stuck runs |
| Reliability | E1 (durability), E5/E6 (breakers, health) | zero lost work on crash; orphan recovery |
| Quality assurance | E8 everywhere | regressions caught pre-release; model swaps data-driven (3–10× cost option) |
| Security posture | E5/E6/E16-design | injection framing, tainted-turn approvals, audit trail — enterprise gate |
| Operations | E9, telemetry | cost attribution, approval inbox, run inspector |
| Ecosystem/DX | E10, plugin system | 15-min quickstart, plugin flywheel, CLI-on-SDK completeness |
| Maintainability | consolidation (E7), kernel/plugin split | 33 packages → ~8 kernel + plugins; debt backlog retired |

---

**Stop point.** Blueprint complete. No code written. Next instruction decides: Phase 1 kickoff (ADR-0010 implementation on current repo), RFC drafting, or blueprint revisions.
