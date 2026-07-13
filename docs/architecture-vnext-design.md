# Hermes vNext — Architecture Design Document

> **⚠️ DEPRECATED — DO NOT EXECUTE.**
> This greenfield/vNext plan is superseded by [architecture-evolution-ledger.md](architecture-evolution-ledger.md).
> The current repository is the product; all changes follow the evolutionary (KEEP/EXTEND/REFACTOR) doctrine.
> Kept for reference only: design rationale and rejected alternatives remain useful reading.


**Status:** DEPRECATED (superseded by architecture-evolution-ledger.md)
**Date:** 2026-07-10
**Author:** Lead Architect
**Predecessor:** [architecture-review-vnext.md](architecture-review-vnext.md) (findings referenced throughout as *Review §n*)

---

## 1. Vision and Design Principles

Hermes vNext is an **AI Engineering Platform**: a runtime, control plane, and SDK for building, running, and continuously improving AI agents — from a single-user local CLI to a multi-tenant enterprise deployment — without rewriting the agent when the deployment tier changes.

### What we keep from Hermes v1

Worth keeping (proven in production, ahead of peers):

- **Provider routing + fallback chains** (18 providers, route classification)
- **Runtime abstraction** (local SDK loop vs vendor-CLI runtimes: Claude Code, Cursor, Codex, SSH, Daytona, Modal)
- **Approval checkpoint/resume** (durable human-in-the-loop pauses)
- **Markdown-first agent definition** (frontmatter + persona body)
- **Progressive infrastructure tiers** (filesystem → SQLite → Postgres/Qdrant/NATS)
- **Two-layer auth separation** (model API keys vs runtime OAuth)
- **Channel breadth** (14 adapters) — as a plugin family, not core

Everything else is redesigned.

### Design Principles

1. **The agent loop is a graph, not a function.** Every step (prompt assembly, model call, tool execution, reflection) is a node with typed inputs/outputs, checkpointable between nodes. This is the single biggest structural change from v1's 409-line generator (*Review §2*). Borrowed from LangGraph; but nodes are platform-defined, not user-assembled — users get the power without the graph-authoring burden unless they want it.
2. **Everything versioned, everything attributable.** Prompts, workflows, knowledge, skills, and configs carry content hashes. Every session records the exact versions that produced it. No eval, rollback, or audit is possible without this; it costs almost nothing if designed in from day one (*Review §3, §15*).
3. **Token budget is a first-class runtime concern.** Context assembly is a budgeted allocation problem, not string concatenation. The Context Compiler (§7) owns the window; nothing enters context unmetered (*Review §4*).
4. **Local-first is a deployment tier, not a fork.** One codebase; capability interfaces resolve to filesystem/SQLite implementations locally and to Postgres/object-store/queue implementations in server mode. The tier is configuration, never `if (isLocal)` branches in domain logic.
5. **Measured before optimized, evaluated before shipped.** Telemetry and the eval harness are core services, not add-ons. A prompt change that regresses golden trajectories fails CI.
6. **Small kernel, everything else a plugin.** The kernel is: agent graph executor, context compiler, model gateway, tool bus, state store, event bus. Channels, RAG, voice, kanban, souls, learning — all plugins on stable extension points (§21). v1's 33-package sprawl becomes ~8 kernel packages + a plugin ecosystem.
7. **Untrusted by default.** Tool outputs, retrieved documents, and channel messages are data, never instructions. Provenance labels flow through the context. Capability-scoped tool grants, not global enable flags (*Review §13*).

### Non-goals

- Not a general workflow orchestrator (Airflow/Temporal replacement) — DAGs exist to serve agents.
- Not a model host — we route to providers/local servers (Ollama, vLLM), we don't serve weights.
- Not a no-code builder in v1 of vNext — SDK and config first; visual builder is a later plugin.

---

## 2. Core Architectural Layers

Five layers, strict downward dependencies:

```
┌─────────────────────────────────────────────────────────┐
│  L5  Surfaces        CLI · TUI · Web · IDE (ACP) · API  │
│                      Channels (Slack/Discord/…)          │
├─────────────────────────────────────────────────────────┤
│  L4  Control Plane   Registry · Scheduler · Approvals   │
│                      Tenancy · Policy · Eval · Billing   │
├─────────────────────────────────────────────────────────┤
│  L3  Agent Runtime   Graph Executor · Context Compiler  │
│                      Planner · Reflection · Memory Mgr   │
├─────────────────────────────────────────────────────────┤
│  L2  Capability      Model Gateway · Tool Bus · MCP     │
│      Gateways        Knowledge Service · Sandbox         │
├─────────────────────────────────────────────────────────┤
│  L1  Substrate       State Store · Blob Store · Event   │
│                      Bus · Queue · Secrets · Telemetry   │
└─────────────────────────────────────────────────────────┘
```

- **L1 Substrate** — pluggable infrastructure ports. Each has a local (filesystem/SQLite/in-process) and server (Postgres/S3/NATS/Redis) implementation. Nothing above L1 knows which is active.
- **L2 Capability Gateways** — the only code that talks to the outside world: LLM providers, tools, MCP servers, vector/FTS indexes, sandboxes. Each gateway enforces policy, records telemetry, applies caching. Domain logic never calls a provider SDK directly.
- **L3 Agent Runtime** — the graph executor and its cognitive services. Pure orchestration over L2/L1 interfaces. Fully testable with fake gateways.
- **L4 Control Plane** — multi-agent, multi-user, multi-project concerns: what exists (registry), when it runs (scheduler), who may do what (policy), whether it's good (eval).
- **L5 Surfaces** — thin adapters. A surface translates its protocol (TTY, HTTP, Slack events, ACP) into control-plane calls and event-stream subscriptions. Surfaces contain zero domain logic (v1 mostly got this right; keep the discipline).

**Rejected alternative:** hexagonal-per-package as in v1 (33 packages each with own ports). Correct instinct, too fine-grained — boundary overhead exceeded content (*Review §1*). vNext draws boundaries at the five layers plus plugin seams, with ~8 kernel packages.

---

## 3. High-Level Component Diagram (C4)

### C4 Level 1 — System Context

```
                    ┌──────────────┐
   Developers ─────►│              │◄───── End users (Slack, Web, Voice…)
   (CLI, IDE, SDK)  │    Hermes    │
                    │    vNext     │◄───── Operators (admin console, policy)
                    │              │
                    └──┬───┬───┬───┘
                       │   │   │
        LLM Providers ─┘   │   └─ Enterprise systems (SSO, Confluence,
   (Anthropic, OpenAI,     │       GitHub, Jira, data warehouses)
    Gemini, local vLLM…)   │
                     MCP Servers & Tools
```

### C4 Level 2 — Containers

```
┌ Surfaces ────────────────────────────────────────────────────────┐
│  hermes-cli   hermes-web   hermes-api   channel-adapters  acp    │
└───────┬───────────────────────────────────────────────────┬──────┘
        │ gRPC/HTTP + event stream (SSE/WS)                 │
┌───────▼───────────────────────────────────────────────────▼──────┐
│ Control Plane (hermesd)                                          │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐ ┌───────────┐  │
│  │ Registry │ │Scheduler │ │ Policy  │ │ Eval   │ │ Approvals │  │
│  └──────────┘ └──────────┘ └─────────┘ └────────┘ └───────────┘  │
├──────────────────────────────────────────────────────────────────┤
│ Agent Runtime (embedded in hermesd, or separate worker pool)     │
│  ┌───────────────┐ ┌─────────────────┐ ┌─────────────────────┐   │
│  │ Graph Executor│ │ Context Compiler│ │ Memory Manager      │   │
│  └───────────────┘ └─────────────────┘ └─────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│ Capability Gateways                                              │
│  ┌───────────────┐ ┌──────────┐ ┌───────────────┐ ┌──────────┐   │
│  │ Model Gateway │ │ Tool Bus │ │ Knowledge Svc │ │ Sandbox  │   │
│  └───────────────┘ └──────────┘ └───────────────┘ └──────────┘   │
├──────────────────────────────────────────────────────────────────┤
│ Substrate: State Store · Blob Store · Event Bus · Queue ·        │
│            Secrets · Telemetry                                   │
└──────────────────────────────────────────────────────────────────┘
```

Key topology decision: **one process locally, many processes in server mode.** `hermesd` is a modular monolith; every internal boundary is an in-process interface that can be re-bound to a network transport (queue-backed workers, separate knowledge service) via configuration. We deliberately reject microservices-by-default: at local tier there is one binary; at enterprise tier the worker pool and knowledge service split out first, everything else stays co-located until load proves otherwise.

---

## 4. Runtime Architecture

### The Graph Executor

An agent run is an instance of an **execution graph**. The platform ships a standard graph (the "ReAct+ graph"):

```
 intake ─► compile-context ─► model ─► route ─┬─► tool-exec ─► compile-context (loop)
                                              ├─► approval-wait (suspend)
                                              ├─► reflect ─► model (bounded retry)
                                              └─► finalize ─► learn
```

Properties:

- **Nodes are typed and side-effect-declared.** Each node declares reads/writes (context, memory, external). The executor uses this for checkpointing, replay, and parallelism.
- **Checkpoint between every node.** Run state (message log, node cursor, accumulated usage, pending effects) serializes to the State Store after each node. Any run is resumable after crash, approval pause, or human interruption — generalizing v1's approval-only checkpoints to universal durability. This is the Temporal insight applied at agent granularity, without adopting Temporal (heavyweight dependency, poor local story).
- **Suspension is a first-class node outcome.** `approval-wait`, `human-input-wait`, `timer-wait`, `event-wait` all suspend identically. Scheduler resumes on signal.
- **Custom graphs are a power feature, not the default.** SDK users can define graphs (LangGraph-style) but 95% of agents use the standard graph parameterized by config. This avoids Mastra/LangGraph's trap where every user must be a graph author.

**Rejected alternatives:**
- *Plain loop (v1, Claude Code style):* simplest, but untestable in parts, no universal resume, no parallel tool branches. We keep its ergonomics via the standard graph.
- *Full workflow engine (Temporal/Airflow):* durability for free, but massive operational cost, terrible local-first story, impedance mismatch with streaming LLM calls.
- *Actor model (AutoGen style):* natural for multi-agent chat, weak for durable single-agent runs; multi-agent is instead modeled as graphs spawning sub-runs (§14).

### Execution Backends

The **runtime provider abstraction survives from v1** and sits *under* the graph: a `tool-exec` or entire sub-run can execute on a backend — local process, Docker sandbox, SSH host, Daytona/Modal cloud sandbox, or a **vendor agent runtime** (Claude Code SDK, Codex, Cursor). Vendor runtimes are modeled as opaque "mega-nodes": the graph delegates a whole task and receives a trajectory back, which is normalized into the run log for uniform telemetry/eval.

### Concurrency & Streaming

- Every model node streams; deltas publish to the Event Bus under the run's topic; surfaces subscribe. No surface ever holds the model connection.
- `AbortSignal` propagates from run → node → gateway → provider HTTP call (fixes v1's soft-stop, *Review §2*).
- Independent tool calls in one model turn execute in parallel by default, bounded by per-run and per-tenant concurrency budgets.

---

## 5. Agent Lifecycle

An **Agent** is a versioned declaration; a **Run** is an execution; a **Session** is a conversational thread of runs.

```
 Author ─► Validate ─► Register(vN) ─► [Evaluate] ─► Activate
                                                        │
   Instantiate: Session created (channel, user, project)│
                                                        ▼
   Run: intake → graph execution → finalize ──► Learn (post-run)
                                                        │
   Evolve: learning proposals ─► soul-gate/human review ─► new version vN+1
                                                        │
   Retire: deactivate version; sessions pin their version until migrated
```

- **Authoring** stays Markdown-first (frontmatter: model prefs, tools, skills, memory policy, graph params; body: persona). Validation is schema + lint (undefined tool refs, missing skills) + optional eval gate.
- **Registration** assigns immutable version = content hash. The Registry (L4) stores lineage. Active sessions **pin** the version they started with; upgrades are explicit (auto for patch-level persona edits if policy allows).
- **Learning loop** (kept from v1, formalized): post-run, the Learn node emits *proposals* — memory writes, skill drafts, persona amendments. Proposals route through the policy layer (v1's soul-gate concept): auto-apply, queue for human review, or reject. Applied proposals create new agent/skill versions. **Nothing self-modifies in place** — evolution is always a new version with provenance.

## 6. Execution Flow

One user turn, standard graph, server tier:

1. **Surface** receives message → control plane resolves tenant/project/agent/session → enqueues run (or executes inline at local tier).
2. **Intake node:** normalize input, attach provenance (`channel:slack`, `user:x`), guardrail scan (§16).
3. **Context Compiler (§7):** builds the model request under an explicit token budget from: system layers (persona/skills/soul), memory lanes, retrieved knowledge, tool schemas (selected, not all), and windowed history. Emits a **Context Manifest** — hashes and token counts of every included segment — persisted with the checkpoint.
4. **Model node:** Model Gateway resolves route → executes with fallback chain → streams deltas to Event Bus → records usage/cost/cache metrics.
5. **Route node:** model output contains tool calls → Tool Bus; requires approval → suspend with checkpoint; reflection triggered (error, low confidence, policy) → reflect node; else → finalize.
6. **Tool-exec node:** policy check per call (scope, rate, tenant) → execute (parallel where independent, sandboxed where required) → results clipped by output budget, full payloads to Blob Store with reference links → loop to Context Compiler.
7. **Finalize:** persist assistant message, close streams, emit `run.completed`.
8. **Learn (async, off critical path):** summarization, memory distillation, skill-draft proposals, eval sampling.

Every step emits structured events; the run log is the single source of truth for replay, eval, and audit.

## 7. Prompt System

### Context Compiler — the heart of vNext

v1 concatenated strings (*Review §3–4*). vNext treats context as **budgeted allocation across prioritized segments**:

| Segment | Source | Priority | Cache tier |
|---|---|---|---|
| Platform header | kernel | fixed | cached (stable) |
| Persona | agent version | fixed | cached (stable) |
| Skills (active) | skill registry | high | cached (semi-stable) |
| Tool schemas | Tool Bus selection | high | cached (semi-stable) |
| Soul/identity | soul plugin | medium | cached |
| Memory lanes | Memory Manager | budgeted | uncached |
| Retrieved knowledge | Knowledge Svc | budgeted | uncached |
| History window | session log | budgeted (largest) | incremental cache |
| Current input | intake | fixed | uncached |

- **Budgeting:** compiler receives `maxContextTokens` (model-derived) minus reserved output; allocates by priority; degrades gracefully (drop lowest-value memory before truncating history; summarize history before dropping skills).
- **Cache-aware ordering:** stable segments first, ordered for maximal provider prefix-cache hits (`cache_control` breakpoints placed by the compiler, not by providers ad hoc). This bakes *Review §4* P0 items into the architecture rather than patching them in.
- **Provenance labels:** untrusted segments (tool output, retrieved docs, channel content) wrapped in data-framing delimiters with source tags (§16).

### Prompt Registry

- Every prompt artifact (persona, skill instruction, platform header, workflow prompt) is content-addressed and versioned in the Registry.
- Sessions record the **Context Manifest** per model call → exact reproducibility of any historical call.
- **Prompt tests:** golden assertions attached to prompt versions (must-contain, token ceiling, eval-suite score threshold) run in CI. DSPy-style automatic prompt optimization is a later plugin operating on this registry — the registry is the prerequisite, so build it first.

Templating: minimal, logic-less interpolation (variables + conditionals) only. Full template languages in prompts create untestable branching; conditional structure belongs in the compiler, not the template.

## 8. Memory Architecture

Three explicit lanes, each with its own store, writer, retrieval policy, and TTL — replacing v1's raw-turn mirroring (*Review §5*):

| Lane | Content | Writer | Retrieval | Decay |
|---|---|---|---|---|
| **Episodic** | session summaries, event digests | Learn node (LLM-distilled) | recency + relevance | TTL + compaction |
| **Semantic** | facts about user/project/world | Learn node proposals (deduped, contradiction-checked) | hybrid search, type-weighted | supersession (new fact replaces old) |
| **Procedural** | skills, learned playbooks | skill registry via learning proposals | trigger/route match | versioned, never silently decays |

- **Working memory** (current run scratchpad: todo state, intermediate results) lives in the run checkpoint, not the memory system — it dies with the run unless distilled.
- **History window** is session state, not "memory": sliding window + rolling summary owned by the Context Compiler.
- **Retrieval scoring:** `relevance × recency-decay × type-weight × confidence`. Every recalled memory carries provenance (which session produced it) for auditability and user-facing "why do you know this."
- **Privacy:** per-lane TTL and per-tenant redaction policy; memory delete-by-user is a first-class API (GDPR).
- Storage: local tier = SQLite (FTS5 + sqlite-vec); server tier = Postgres (pgvector) with optional Qdrant for scale. Same `MemoryStore` interface.

## 9. Knowledge & RAG Architecture

Design stance (from *Review §6*): **retrieval quality comes from boring components measured well**, not exotic techniques. Baseline first, evals always, sophistication only when evals demand it.

```
 Sources ─► Connectors ─► Normalizer ─► Chunker ─► Enricher ─► Indexer ─► Stores
 (files, git, Confluence,  (to canonical  (structure-  (contextual   (FTS + vector
  web, GitHub, DBs)         doc model)     aware)       headers,      + metadata)
                                                        metadata)
 Query ─► Query Planner ─► Hybrid Retrieval (BM25 + vector, RRF fusion)
             │                    │
             │                    ▼
             │              Reranker (optional, cross-encoder)
             │                    ▼
             └──────────► Context assembly (parent expansion, dedup,
                          compression, source-tagged, budgeted by §7)
```

- **Canonical document model:** every source normalizes to `{content, structure, metadata, provenance, version, hash}` before chunking. Connectors are plugins.
- **Chunking:** structure-aware (headings for Markdown/docs, AST symbols for code — Continue/Cursor's key insight for code retrieval). Parent-child: index chunks, retrieve chunk → expand to parent section under budget.
- **Contextual enrichment:** at index time, prepend an LLM-generated doc-level context header to each chunk (Anthropic contextual retrieval). Cost is one-time per chunk; paid only at ingest.
- **Hybrid retrieval is the floor:** BM25 (FTS5/Postgres FTS) + vector, fused with reciprocal rank fusion. BM25-only is the Level-1 fallback (no embedding dependency, works offline).
- **Freshness/versioning:** documents carry version + validity window; retrieval filters stale versions; re-index is incremental (§10). Knowledge bases are versioned snapshots — an agent version can pin a KB version (deterministic evals).
- **Deferred until evals justify:** knowledge graphs, HyDE, multi-query expansion, self-query. Each is a plugin slot on the Query Planner.

## 10. Indexing Pipeline

- **Content-hash incremental:** manifest stores `sha256` per source item; only changed items re-flow (fixes v1's full re-copy, *Review §7*).
- **Background + resumable:** indexing jobs run on the Queue as checkpointed batches; a 100k-doc crawl survives restarts. Parallel across documents, ordered within.
- **Two-phase visibility:** new index generation builds alongside the live one; atomic swap on completion (no half-indexed retrieval states).
- **Deduplication:** content-hash exact dedup at ingest; near-dup (simhash) flagged in metadata for retrieval-time suppression.
- **Embedding versioning:** index records embedding model + version; model change triggers a background re-embed generation, old generation serves until swap. Never mix embedding spaces in one index.

## 11. Tool & MCP Architecture

### Tool Bus

All tool execution — builtin, MCP, plugin, composable-skill — flows through one bus:

```
 model tool_call ─► Policy Gate ─► Resolver ─► Executor ─► Output Governor ─► result
                    (scope, rate,   (builtin /   (timeout,    (clip to budget,
                     approval,       MCP /        retry,       blob-store full
                     tenant)         plugin)      sandbox,     payload, provenance
                                                  parallel)    tag)
```

- **Per-tool policy object** replaces v1's boolean enable (*Review §10*): `{enabled, scope: [agents/projects], approval: auto|ask|deny, timeoutMs, retries, rateLimit, sandbox: none|process|container, outputBudgetTokens}`. Declarative in config, enforced centrally.
- **Dynamic tool selection:** the Context Compiler asks the Tool Bus for the *relevant* tool schemas per turn (agent's declared tools + route-matched + recently used), not all 73. Claude Code's deferred-tools pattern: full catalog searchable via a `tool_search` meta-tool; schemas load on demand. Cuts steady-state schema tokens 60–80%.
- **Output governance:** results exceeding budget are head/tail-clipped in context with a blob reference; a `read_artifact` tool retrieves ranges. No unbounded payloads in context, ever.
- **Health:** per-tool circuit breakers, latency/error metrics, MCP server health probes; unhealthy tools drop out of the offered schema set with an advisory note.

### MCP

- MCP is the **native protocol for external tools** — first-class, not bridged as an afterthought. Registry-managed server configs per project/tenant; OAuth handled by the control plane; tool catalogs cached with TTL.
- Hermes is also an **MCP server**: agents, memory search, and knowledge retrieval exposed as MCP tools so IDEs and other hosts can drive Hermes (interop moat vs closed peers).
- Sandboxing: MCP servers run out-of-process always; stdio servers get process isolation, resource caps, and workspace-scoped filesystem views.

## 12. Model Provider Layer

**Model Gateway** — one choke point for every LLM/embedding/rerank call (LiteLLM's role, internal):

- **Canonical request/response model** with lossless provider adaptation (system blocks, tool schemas, cache hints, thinking budgets). Adapters: Anthropic, OpenAI-compatible (covers most), Gemini, Bedrock/Vertex, local (Ollama/vLLM via OpenAI-compat).
- **Capability descriptors** per model: context window, native tools, vision, caching semantics, cost table, latency class. The compiler and router consume descriptors — no hardcoded model knowledge in domain logic.
- **Cross-cutting at the gateway:** prompt-cache breakpoint placement, retry with jitter, fallback chains, per-tenant rate/spend limits, usage metering, request/response capture (sampled) for eval.
- **Two auth layers preserved** from v1 (API keys vs runtime OAuth) — the gateway owns key pools (encrypted, rotating); vendor-runtime OAuth stays in the Runtime Backend layer. The v1 footgun (env var shadowing OAuth) is eliminated: precedence is explicit config, never ambient environment.

## 13. Model Routing Strategy

Routing = policy function: `(task class, agent prefs, tenant policy, live provider health, budget state) → ordered candidate list`.

- **Task classification:** cheap heuristic classifier (v1's `classifyTask`, kept) upgraded with optional small-model classification for ambiguous cases; skills contribute routing hints.
- **Route tiers:** `reasoning`, `coding`, `fast/cheap`, `vision`, `embedding`, `rerank`. Agents declare preferences per tier; tenants can pin/deny models (compliance).
- **Fallback:** ordered chain per route with health-aware skipping (circuit breaker per provider) and downgrade rules (reasoning → coding-tier on sustained failure, with event emitted).
- **Budget-aware degradation:** when a tenant/run approaches spend limits, router shifts to cheaper tiers before hard-stopping; always logged, never silent.
- **Rejected:** learned routing (bandit over models) at core — high complexity, weak local story; plugin slot later, fed by eval data.

## 14. Workflow / Planner Engine

Three coordination levels, one substrate (the graph executor):

1. **Implicit planning (default):** the standard graph's model node plans via todo-state working memory. Sufficient for most tasks (Claude Code's proof).
2. **Declarative workflows:** versioned YAML DAGs — steps are agent runs, tool calls, human gates, timers, event waits. Compiled to executor graphs → inherit checkpointing, resume, streaming for free. This replaces v1's separate `workflows`/`automation`/`batch` packages with one engine; cron/scheduled agents are just workflows with timer triggers.
3. **Multi-agent collaboration:** modeled as **runs spawning sub-runs** with typed contracts (task in, structured result out), not free-form agent chat rooms. Patterns shipped as workflow templates: fan-out/verify, judge panel, pipeline, supervisor. Sub-runs get isolated context (fresh compile, scoped memory) — no shared mutable prompt state. CrewAI/AutoGen-style open conversation between agents is deliberately excluded from core: poor determinism, unbounded cost; can exist as a plugin.

## 15. Reflection & Evaluation Pipeline

- **In-run reflection:** a bounded reflect node triggered by tool errors, guardrail flags, or explicit self-check policy — re-prompts with critique framing, max N attempts, all attempts logged. Not enabled by default for chat (latency); default-on for autonomous/scheduled runs.
- **Post-run evaluation:** async samplers score runs (rubric LLM-judge, task-specific checkers, user feedback signals). Scores attach to the run log and to the versions in its Context Manifest — automatically building per-prompt-version and per-agent-version quality series.
- **Golden trajectory harness:** curated runs replayed against fake gateways in CI; prompt/graph/tool changes diff against goldens. Registry gates (§5) can require eval-suite pass before version activation.
- **Feedback loop closure:** eval regressions on a prompt version auto-open review items; learning-loop proposals cite eval evidence. This is the DSPy-shaped 20% (measure → propose → verify) without adopting DSPy's compiler model.

## 16. Security Model

Written plainly, as this is safety-critical:

- **Identity & access:** control plane authenticates surfaces (OIDC/SSO in server mode; local mode implicit single user). Authorization is policy-based: subjects (user, agent, workflow) get scoped grants over resources (projects, tools, knowledge bases, models). Agents are principals — an agent acting for a user carries both identities, and effective permission is the intersection.
- **Prompt injection defense in depth:** (1) all untrusted content (tool output, retrieved docs, inbound channel messages) is provenance-tagged and wrapped in data-framing by the Context Compiler; (2) guardrail scan at intake and on tool outputs (pattern + classifier, pluggable); (3) high-risk tools (shell, file write, payments, messaging) require approval when the triggering turn contains untrusted content — "tainted turn" rule; (4) approval UI shows exactly what will execute.
- **Tool abuse containment:** capability-scoped grants, per-tool rate limits, sandbox tiers (process/container/remote), workspace-scoped filesystem views, egress allowlists for sandboxed execution.
- **Secrets:** encrypted at rest (age/KMS by tier), never enter model context, injected into tool execution environments at call time, redaction filter on all logs and run captures.
- **Data protection:** per-tenant encryption scopes in server mode; memory and knowledge honor TTL and delete-by-user; PII detection at memory-write time (pluggable) with block/redact/allow policy.
- **Audit:** every control-plane mutation and every run is an immutable audit event with actor, resource, and version references.

## 17. Multi-tenant Design

Hierarchy: **Tenant → Project → Workspace → (Agents, Sessions, Knowledge, Memory)**.

- **Local tier:** one implicit tenant/user; zero auth friction preserved (v1's virtue).
- **Server tier isolation:** Postgres row-level security keyed by tenant; per-tenant blob prefixes and encryption keys; queue fairness (per-tenant concurrency and priority); per-tenant spend budgets enforced at the Model Gateway.
- **Rejected:** database-per-tenant (operational burden at target scale) and separate-deployment-per-tenant (kills the SaaS economics); RLS + key scoping achieves the isolation bar for the intended market. Regulated customers get single-tenant deployment of the same binary — the tier system already supports it.
- Cross-tenant sharing (blueprint/skill marketplace) flows only through the Registry with explicit publish/subscribe — never direct data access.

## 18. Storage Architecture

| Concern | Local tier | Server tier |
|---|---|---|
| State (sessions, runs, checkpoints, registry) | SQLite (WAL) | Postgres |
| Blobs (artifacts, tool payloads, captures) | filesystem CAS | S3-compatible CAS |
| Search (memory, knowledge FTS) | SQLite FTS5 | Postgres FTS |
| Vectors | sqlite-vec | pgvector → Qdrant at scale |
| Queue | SQLite-backed | NATS JetStream / Redis |
| Events | in-process bus | NATS |
| Secrets | age-encrypted file | KMS/Vault |

- **Immediate v1 fix baked in:** no whole-file JSON rewrite patterns; SQLite WAL from day one even at local tier (fixes concurrent-channel data loss, *Review §17*). Human-readable exports (`sessions/*.jsonl`) become a *view* generated from the store, preserving local-first inspectability without making files the source of truth.
- **Content-addressed store (CAS)** unifies artifacts, prompt versions, knowledge snapshots, and tool payload offloads — dedup and immutability for free.
- Migrations: single migration framework across both engines (schema defined once, dialect-generated).

## 19. Observability & Telemetry

- **OpenTelemetry-native:** every run is a trace; nodes are spans; model/tool calls are child spans with standard attributes (`gen_ai.*` semconv). Exporters: console/file locally, OTLP in server mode.
- **Structured logging** (single logger, injected; no `console.*`, no silent catches — lint-enforced).
- **Core metric set:** tokens in/out/cached per call, cost estimate, latency histograms per provider/model/tool, cache hit ratios (prompt cache, semantic cache, tool cache), retrieval metrics (recall@k against eval sets, staleness), queue depth, suspension counts, approval latency, eval scores.
- **Cost attribution:** every token attributed to tenant/project/agent/session/node — the cost dashboard is a query, not a subsystem.
- **Run inspector:** first-class UI/CLI to replay any run from its checkpoints and Context Manifests — the debugging experience is the product for agent developers (Cursor/Claude Code lesson).

## 20. Cost Optimization Strategy

Layered, all measured via §19:

1. **Prompt caching by construction** — compiler orders stable segments and places cache breakpoints (§7). Expected: 60–90% discount on the stable prefix, hit on nearly every turn ≥2.
2. **Bounded history** — sliding window + rolling summary, budget-enforced (§7).
3. **Tool schema selection** — relevant subset per turn (§11).
4. **Output governance** — clip + blob-reference (§11).
5. **Route-tier economics** — cheap models for classification/summarization/memory distillation; frontier models only where route demands (§13).
6. **Semantic cache** (plugin) — embedding-keyed response cache for repeated/near-duplicate queries; opt-in per agent (correctness risk owned explicitly).
7. **Batch lanes** — non-interactive work (learning, eval, indexing enrichment) routed to provider batch APIs at ~50% discount.
8. **Budgets as backpressure** — per-run/tenant token budgets enforced at the gateway; degradation ladder (cheaper route → smaller context → suspend-and-ask) instead of silent overrun.

Combined expectation vs v1 behavior: **70–85% input-token cost reduction** on long sessions (compiler + caching + windowing), with the telemetry to prove it per tenant.

## 21. Plugin / Extension System

Stable extension points, versioned independently of the kernel:

| Extension point | Examples |
|---|---|
| Surface / Channel | Slack, Discord, WhatsApp, voice, TUI themes |
| Tool provider | builtin packs, enterprise connectors |
| Knowledge connector | Confluence, GitHub, web crawler, DB |
| Memory lane / store | Honcho delegate, custom stores |
| Graph node | custom reflection, domain validators |
| Guardrail | PII detectors, compliance scanners |
| Router policy | learned routing, cost policies |
| Learning proposal handler | soul-gate variants, review UIs |
| Eval scorer | domain rubrics, task checkers |

- **Manifest + capability grants:** a plugin declares extension points, required permissions, and config schema; installation is a policy decision (tenant admins approve capability sets).
- **In-process by default, out-of-process available** for untrusted plugins (same interface, transport-swapped — mirrors the modular-monolith stance).
- v1's souls, kanban, goals, voice, channels all become plugins on these seams — the kernel stops paying their complexity tax (*Review §1*).

## 22. Public SDK Design

- **TypeScript-first SDK, thin API clients for Python and others.** Rationale: kernel is TS; a full parallel Python runtime (Mastra/LangGraph both suffered dual-runtime drift) doubles maintenance for uncertain gain. Python users get: full control-plane API client, tool-server SDK (write tools in Python, served via MCP), and eval-harness client.
- **SDK surfaces, in order of abstraction:**
  1. `hermes.chat(agent, input)` — one-liner, streaming iterator.
  2. Agent/session/run management, event subscription, approval handling.
  3. Custom tools, custom graph nodes, custom graphs.
  4. Plugin authoring kit (manifest, test harness, publishing).
- **Everything the CLI does, the SDK does** — CLI is an SDK consumer, guaranteeing the SDK is complete (Gemini CLI/OpenCode lesson).
- Stability contract: SDK and plugin APIs semver'd; kernel internals explicitly unstable.

## 23. Configuration System

- **Layered resolution:** defaults → tenant policy → project (`hermes.yaml`) → workspace → agent frontmatter → run overrides. Every resolved config is schema-validated (zod, kept from v1) and content-hashed into the run's manifest — config is versioned like everything else.
- **Markdown for agents/skills/personas, YAML for infra/workflows** — v1's split, kept deliberately: prose-heavy artifacts in Markdown, structural artifacts in YAML.
- **No ambient environment variables in domain logic.** Env vars map into config at the boundary with explicit precedence; eliminates the v1 API-key-shadowing class of bug.
- `hermes doctor` validates the full resolved configuration (keys present, providers reachable, tools healthy) — configuration failures at startup, not mid-run.

## 24. API Design

- **Transport:** HTTP/JSON + SSE for streams (WebSocket optional for channels needing duplex). gRPC internal between control plane and worker pools. Rejected GraphQL: event-stream-heavy workload fits SSE/WS better; resource surface is small enough for clean REST.
- **Resource model:** `/tenants/{t}/projects/{p}/agents`, `/agents/{id}/versions`, `/sessions`, `/sessions/{id}/runs`, `/runs/{id}` (+ `/events` SSE, `/checkpoints`, `/approvals`), `/tools`, `/knowledge-bases/{kb}/versions`, `/memory` (query + delete-by-user), `/workflows`, `/evals`, `/audit`.
- **Runs are the universal execution resource** — chat turns, scheduled jobs, workflow steps, sub-agent tasks are all runs; one status model (`queued/running/suspended/completed/failed/cancelled`), one event stream shape, one approval mechanism.
- Versioned API (`/v1`), idempotency keys on mutations, cursor pagination, webhook subscriptions for `run.*`, `approval.*`, `eval.*` events.

## 25. Folder Structure

```
hermes/
├── kernel/                     # the ~8 core packages, strict layer deps
│   ├── contracts/              # schemas, interfaces, canonical models (v1 core, slimmed)
│   ├── substrate/              # state/blob/queue/event/secret ports + local & server impls
│   ├── model-gateway/
│   ├── tool-bus/               # + MCP client/server
│   ├── knowledge/              # pipeline + retrieval + index mgmt
│   ├── runtime/                # graph executor, context compiler, memory manager,
│   │                           #   planner, reflection, runtime backends
│   ├── control-plane/          # registry, scheduler, policy, approvals, eval, tenancy
│   └── telemetry/
├── surfaces/
│   ├── cli/  api/  web/  acp/
├── plugins/                    # first-party plugins (channels, souls, kanban, voice,
│                               #   connectors, guardrails) — same API as third-party
├── sdk/
│   ├── typescript/  python-client/
├── workflows/                  # shipped workflow templates (fan-out, judge-panel…)
├── evals/                      # golden trajectories, scorers, CI harness
└── docs/                       # numbered docs + ADRs (practice kept from v1)
```

~8 kernel packages + plugin trees replaces v1's 33 flat packages: boundaries where variation actually happens (plugins, substrate impls), cohesion where it doesn't (kernel).

## 26. Migration Strategy from Hermes v1

Strangler-fig, four phases; **never a big-bang rewrite** — v1 keeps shipping throughout.

- **Phase 0 — Fund the migration (≈ v1's P0 list):** implement ADR-0010 (caching, windowing, clipping) and telemetry *in v1*. Pays for the migration in cost savings and produces baseline metrics to validate vNext against.
- **Phase 1 — Contracts & substrate:** extract vNext `contracts` from v1 `core` (schemas largely survive); build substrate with SQLite/WAL local impls; migrate v1 session/memory persistence onto substrate behind existing interfaces. v1 file layouts become export views. *Data migration tool: v1 JSON/JSONL → substrate, checksummed.*
- **Phase 2 — Gateways:** stand up Model Gateway (absorbs `models` — providers port nearly as-is) and Tool Bus (absorbs `tools` gateway + `integrations` MCP; per-tool policy replaces boolean flags). v1 runtime calls gateways via adapters — v1 agents get vNext caching/policy/telemetry *before* the executor changes.
- **Phase 3 — Runtime:** graph executor + context compiler; standard graph reproduces `DefaultAgentRuntime` semantics; golden trajectories recorded from v1 (Phase 0 telemetry) must replay equivalently. Approval checkpoints migrate to universal checkpoints. v1 runtime deprecated behind a compat flag for one release cycle.
- **Phase 4 — Control plane & plugin extraction:** registry/versioning/eval land; souls, kanban, goals, channels, voice re-home as plugins (mostly mechanical — they already sit behind interfaces); workflow/automation/batch merge into the workflow engine.

Compatibility promises: agent Markdown format unchanged (frontmatter additive); `anvio.yaml` auto-migrates with a converter + deprecation warnings; sessions importable; CLI command surface preserved with aliases.

## 27. Risks and Trade-offs

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Second-system effect** — vNext scope balloons, v1 rots | High | Strangler phases each ship user value; Phase 0 is pure v1 improvement; kernel scope frozen by this doc |
| 2 | **Graph executor complexity** vs v1's simple loop | Medium | Standard graph is the only graph until Phase 4; custom graphs gated behind SDK maturity |
| 3 | **Checkpoint-everything overhead** (latency, storage) | Medium | SQLite/Postgres WAL writes are cheap at this granularity; checkpoint payloads are deltas + CAS refs; measured in Phase 3 gate |
| 4 | **Modular monolith drifts into distributed monolith** | Medium | Only two sanctioned split points (workers, knowledge svc); any further split requires ADR + load evidence |
| 5 | **TS-only kernel alienates Python ML users** | Medium | Python tool-server SDK + API client early; revisit full Python runtime only on demonstrated demand |
| 6 | **Versioning discipline creates authoring friction** | Low-Med | Hash-versioning is automatic; review gates are policy (off by default locally) |
| 7 | **Plugin API stability promised too early** | Medium | Plugin API `experimental` through Phase 4; first-party plugins are the compatibility test suite |
| 8 | **Eval harness under-investment repeats v1's test gap** | High | Eval harness is a Phase 3 *gate*, not a feature: runtime doesn't ship without golden replay passing |
| 9 | **Local-first tier silently degrades** as server features dominate | Medium | CI matrix runs the full suite on local tier; local is the default dev environment by policy |
| 10 | **Trade-off accepted:** no free-form multi-agent chat (vs AutoGen/CrewAI) | — | Deliberate: determinism, cost control, and eval-ability outrank open-ended agent conversation; plugin slot exists if the market disagrees |

---

## Closing

vNext's bet, in one sentence: **the winning agent platform is the one where every run is budgeted, versioned, resumable, measured, and auditable — with a local-first developer experience that never pays for the enterprise machinery until it's turned on.** v1 proved the breadth; vNext makes the breadth trustworthy.
