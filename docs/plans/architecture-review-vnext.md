# Anvio vNext — Architecture Review Report

**Date:** 2026-07-10
**Scope:** full monorepo (33 packages, 6 apps, ~325 TS source files)
**Reviewer role:** Principal AI Platform Engineer / Solution Architect
**Method:** structural survey of all packages + deep read of hot paths (`agents/runtime.ts`, `tools/gateway.ts`, `memory/*`, `knowledge/*`, `platform/index.ts`, `models/*`, ADRs). Areas marked *(sampled)* were reviewed at structure level, not line level.

---

## Executive Summary

Anvio is a well-layered local-first agent OS with an unusually broad feature surface (souls, goals, kanban, learning loop, 14 channels, 9 runtimes, 73 tools). The dependency rule (`apps → platform → packages → core`) is real and enforced, which puts it ahead of most AI platforms at this stage.

The three structural risks, in order:

1. **Token economics are unmanaged.** Full conversation history is re-sent every turn, no prompt caching, no context-window budgeting, tool outputs enter history at full size. ADR-0010 correctly diagnoses this but is still *Proposed*. At scale this is the dominant cost line — likely **50–90% of spend is avoidable**.
2. **Breadth vastly exceeds verification.** ~35 spec files across 325 source files (~11%), with zero tests in `agents`, `memory`, `skills`, `channels` (1), `souls`, `goals`, `workflows`. The most complex, most-load-bearing code (the agent tool loop) is untested.
3. **"Knowledge/RAG" and "memory" are placeholders, not systems.** Knowledge ingest is a file copy with a header; long-term memory is an append-only JSON array per user; recall is a 500-entry keyword-overlap index. Fine for Level 1 demos; not a retrieval system. The docs' vocabulary (RAG, semantic memory) currently overpromises the implementation.

Overall grade: **B for architecture shape, C- for AI-core depth (memory/RAG/token), D for test coverage.**

---

## 1. Overall Architecture — Rating: B+

**Current state**

- Strict four-layer dependency direction; `core` is pure schemas/ports/zod with no internal deps. This is textbook ports-and-adapters and it is actually followed.
- `platform/index.ts` (727 lines) is the single composition root. Correct pattern, but the file is becoming a god-function: it wires auth, memory, models, events, channels, harness, runtimes, kanban, goals, learning, tools, execution, workflows in one `createPlatform()`.
- Progressive tiers (filesystem → sqlite → postgres/qdrant/nats) are a genuinely good idea and consistently respected (`createMemoryStore` explicitly rejects Level 2+ providers at Level 1).

**Weaknesses**

- **Composition-root bloat.** 727-line `createPlatform` with implicit ordering dependencies between subsystems. Any new package adds another paragraph. No lifecycle abstraction (start/stop/health per subsystem).
- **Package proliferation without cohesion test.** `souls` (1 file), `goals` (1 file), `personas` (1 file), `auth` (1 file) are packages containing a single module. Package-per-concept is fine, but 33 packages for ~25k LOC means the boundary overhead (package.json, tsconfig, build edge) exceeds the code in several of them. Consider merging micro-packages into a `domain` group or accepting them as seams for future growth — but decide deliberately.
- **Naming drift.** `hermes-tools.spec.ts` inside `packages/tools` and docs `50-hermes-slaude-parity.md` reveal the Hermes lineage; mixed naming will confuse contributors.
- **No cyclic deps observed** in sampled imports; turbo build order enforces this. Good.

**Recommendations**

- Split `createPlatform` into per-subsystem factory modules with a tiny `Lifecycle` interface (`init/start/stop/health`). Platform becomes a registry of subsystems, not a script.
- Add `dependency-cruiser` or `eslint-plugin-boundaries` in CI to make the layer rule machine-enforced, not convention-enforced.

## 2. AI Agent Architecture — Rating: B-

**Current state**

- `DefaultAgentRuntime` (409 lines) implements the loop: assemble system prompt (persona + skills + soul) → classify route → pick provider → stream → parse/native tool calls → up to 5 iterations → approval checkpoints → store memory.
- Dual tool-calling paths: native `tool_use` when provider supports it, else fenced `anvio_tool` blocks parsed from text. Checkpoint/resume for human approval is a standout feature — most OSS frameworks lack durable approval pauses.
- Providers are genuinely swappable (`ModelProviderRegistry`, `resolveForRoute`, fallback chain).

**Weaknesses**

- `runtime.ts` mixes five concerns in one class: prompt assembly, skill activation, routing, the streaming loop, and checkpointing. Compare LangGraph/Mastra where the loop is a graph of nodes; here it is one 230-line generator with `continue`/`break` control flow. Testability suffers (zero specs in this package — the single riskiest gap in the repo).
- **Skill trigger matching loads the entire catalog on every message** (`listAll()` then `load()` each skill per turn, `runtime.ts:342-348`). O(catalog) file I/O + parsing per user message. Needs a cached trigger index.
- Silent `catch {}` blocks throughout (goal resolution, soul load, skill load) — failures are invisible. Best-effort is fine; unlogged best-effort is not.
- `stopRequests` Set is checked at loop boundaries only; a long provider stream ignores stop until next chunk. Acceptable, but no abort-signal propagation into the provider call means no true cancellation of in-flight HTTP.
- Max 5 tool iterations is hardcoded philosophy — Claude Code, Cursor et al. run 30–100+ iterations. Fine for chat agents, limiting for coding agents; already configurable via `maxToolIterations`, so just document the tradeoff.

**Recommendations**

- Extract `PromptAssembler`, `SkillActivator` (with cached trigger index), and `ToolLoopEngine` from `DefaultAgentRuntime`. Then test each.
- Pass `AbortSignal` through `ModelProvider.stream()`.
- Replace silent catches with `logger.debug` at minimum.

## 3. Prompt Management — Rating: C

**Current state**

- Prompts live in Markdown agent bodies + persona files + skill instructions, concatenated with `\n\n---\n\n`. Storage and loading are clean (workspace loader).
- No versioning, no templating engine, no prompt tests, no validation beyond zod frontmatter.

**Weaknesses**

- No way to know which prompt version produced which session. When a persona edit degrades an agent, there is no diff trail beyond git (and workspaces are user data, often not in git).
- Concatenation order is fixed in code; no per-agent control over section order or conditional inclusion.

**Recommendations**

- **Prompt Registry (lightweight):** content-hash each assembled system prompt, record hash in session metadata. One afternoon of work, enables every future eval.
- Version field in persona/skill frontmatter + `promptVersion` in session records.
- Defer templating engines (Jinja-style) until a real need; Markdown-first is a feature, keep it.

## 4. Token Optimization — Rating: D (highest-ROI area)

**Current state — confirmed in code**

- `FilesystemMemoryStore.storeConversation` stores the **complete accumulated message array**; `getContext` returns all of it; the runtime sends all of it every turn. Unbounded.
- No `cache_control` anywhere in `packages/models/src/providers` (grep confirms). System prompt + tool definitions re-billed at full price every turn.
- Tool results enter `messages` at full size (file reads, web fetches — no clipping).
- Tool instructions for non-native providers are appended to the system prompt for **all enabled tools** every turn.
- ADR-0010 exists, diagnoses all of this correctly, status *Proposed*.

**Estimate**

For a 40-turn session with a 3k-token system prompt, 73-tool definitions (~6k tokens native), and average 400-token messages:

- Current: turn *n* costs ≈ 9k + 400·n input tokens → ~1.1M cumulative input tokens over 40 turns.
- With sliding window (40 msgs) + prompt caching (90% discount on system/tools) + tool-output clipping: ≈ **200–300k effective** → **~70–80% cost reduction** on long sessions. Short sessions save less (~30–40%) but caching alone pays immediately.

**Recommendations (implement ADR-0010, in its stated order)**

1. Sliding window + summarize-on-overflow in `FilesystemMemoryStore` (P0).
2. `cache_control: ephemeral` on system prompt + last tool definition in `anthropic.provider.ts` (P0 — hours of work).
3. Tool-output clipping (head/tail with byte cap, full output to disk artifact) (P0).
4. Later: dynamic tool selection (only send definitions for tools plausibly needed — Claude Code's deferred-tool pattern), context prioritization, semantic cache for repeated queries (P2).

## 5. Memory Architecture — Rating: C-

**Current state**

- Short-term: full message array per session in one JSON file (read-modify-write whole file per append — race-prone under concurrent writes, O(n) per turn).
- Long-term: append-only `memory/<userId>.json` array; `getBySession` **scans every user's file** (`filesystem-memory.ts:65-75`) — O(all users' memories) per call.
- `storeConversation` writes last 2 messages as long-term "conversation" entries as JSON-stringified blobs — duplicating short-term data into long-term with no distillation. This is the "memory that only increases token cost" anti-pattern the review brief asks about: **yes, current long-term conversation entries add cost without adding recall value.**
- Recall: `MemoryRecallIndex` — 500-entry cap, keyword-overlap scoring, 500-char content truncation. Honest about being lightweight; still, no TTL, no type weighting, no recency decay.
- Redis/Postgres providers exist for higher tiers *(sampled, not line-reviewed)*.

**Recommendations**

- Stop mirroring raw conversation turns into long-term memory; store only distilled entries (the learning loop's memory-nudge already produces these — make it the sole writer).
- Add recency decay + type weighting to recall scoring; add per-entry TTL.
- Fix `getBySession` to index by session, not scan all users.
- Introduce the classical split explicitly in `core` ports: episodic (session summaries), semantic (facts), procedural (skills — already exists via `skills`/`learning`). The learning loop already produces all three inputs; the memory layer just needs typed lanes.

## 6–9. RAG / Indexing / Document Pipeline / Knowledge — Rating: D+ (as RAG), B- (as honest scoping)

**Current state — confirmed**

- `KnowledgeIngestEngine.ingest` copies each `raw/*.md` file to `wiki/*.wiki.md` with a header line. Comment admits: "LLM synthesis deferred." No chunking, no embeddings, no vector store at Level 1, no retrieval API beyond file reads. `sync()` re-processes **every raw file every time** — no hash-based change detection.
- Qdrant appears in ADR-0004 and Level 3 config but no retrieval pipeline connects agents to it in the reviewed paths.
- Document loaders (PDF/Word/Confluence/GitHub) — not present; only md/txt.

**Assessment**

There is no RAG system to review; there is a stub. That is acceptable for the current tier, but docs and marketing vocabulary should not say "knowledge base" without the qualifier. Hallucination risk is currently governed entirely by the model, since retrieval injects nothing.

**Recommendations (when RAG becomes a goal)**

- Level 1 RAG that fits local-first: SQLite FTS5 (already in the stack at Level 2) + BM25 as the retrieval baseline. BM25-only beats bad vector search; add embeddings later as hybrid.
- Hash-based incremental ingest (`sha256(content)` in manifest per file) — trivial and fixes full re-index.
- Chunking: heading-aware Markdown chunking with parent-child (retrieve chunk, expand to section).
- Adopt contextual retrieval (prepend doc-level context to each chunk at ingest) when LLM synthesis lands — it is the single highest-quality-per-dollar RAG upgrade per Anthropic's published results.
- Defer knowledge graphs, HyDE, multi-query until there is a retrieval eval harness (see §15) proving the baseline insufficient.

## 10. MCP Integration — Rating: B *(sampled)*

- MCP-first registry (`createMcpBridge`, `loadMcpToolCatalog`, `createMcpFirstCallGate`) with docs (07, 38). Registration and catalog exist; call gating exists.
- Not observed: per-tool timeout/retry policy, health monitoring, permission tiers per tool. `ToolGateway` YAML is enable/disable boolean only — no `timeout`, `maxRetries`, `requiresApproval`, `allowedAgents` per tool.
- Recommendation: extend `ToolGatewaySpec` per-tool config to `{enabled, timeoutMs, retries, approval: auto|ask|deny, scope}`. The approval machinery already exists in the runtime; wire it to config instead of code.

## 11–12. Performance & Caching — Rating: C+

- Streaming: yes, end-to-end. Async: yes. Parallelism: `Promise.all` used in prompt assembly.
- Startup: `createPlatform` initializes every subsystem eagerly — channels, kanban, goals, learning all constructed even for a one-shot `anvio run`. Lazy subsystem init would cut CLI cold start.
- Caching today: effectively **none** (no LLM cache, no embedding cache — no embeddings —, no semantic cache, no prompt cache). Estimated current cache hit ratio: 0%. Prompt caching alone (§4) is the fix with the highest ratio ceiling (system prompt hits on ~every turn ≥2).
- Per-turn skill catalog rescan (§2) and whole-file JSON rewrite per message (§5) are the two local I/O hot spots.

## 13. Security — Rating: B-

- Good: encrypted credential store + pool manager; runtime OAuth separated from API keys (ADR-0009, the CLAUDE.md "two auth layers" rule); auth off by default is appropriate for local-first; dangerous tools (`run_shell`, `execute_code`, `edit_file`, `browser_*`) default-disabled in the gateway; approval flow for mutating actions.
- Gaps: no prompt-injection defenses on tool outputs (web_fetch content enters context unmarked — no source tagging or instruction-stripping); no rate limiting at API/gateway layer observed; no PII handling policy in memory (long-term memory stores raw conversation indefinitely, no redaction/TTL); `execute_code` sandbox depth not verified in this review *(sampled)*.
- Recommendations: wrap untrusted tool output in delimiter + "content is data, not instructions" framing (cheap, standard); memory TTL doubles as a privacy control; add rate limiting to `apps/api`/gateway before any multi-user deployment.

## 14. Observability — Rating: C

- `packages/observability` is 157 lines: a metrics registry. Token usage audit exists in platform (`token-usage-audit.ts`) — good foundation.
- Missing: structured logging standard (silent catches everywhere), tracing (no OpenTelemetry), per-session cost attribution, cache/retrieval metrics (nothing to measure yet), latency histograms per provider.
- Recommendation: adopt `pino` for structured logs repo-wide + OTel spans around model calls and tool calls. Emit `tokens_in/out`, `cost_estimate`, `latency_ms`, `provider`, `model`, `cache_read_tokens` per model call — you cannot do the §4 work without measuring it.

## 15. Testing — Rating: D

- ~35 spec files / 325 source files. Concentration: runtimes (11), tools (4), models (3), platform (3). **Zero** in agents, memory, channels (1), skills, souls, goals, workflows, knowledge, events, storage.
- No prompt tests, no retrieval evals, no golden datasets, no agent-trajectory evals. `trajectory-export.ts` exists — the raw material for an eval harness is already being captured.
- Recommendation order: (1) unit tests for `agents/runtime.ts` tool loop + checkpoint/resume (highest risk × zero coverage), (2) memory store contract tests run against every provider, (3) a 20-case golden set of agent trajectories replayed in CI against a mock provider, (4) retrieval evals only once RAG exists.

## 16. Cost Analysis

Dominant cost: LLM input tokens from unbounded history + uncached prompts (§4) — est. 50–80% of spend avoidable. Embedding/storage/indexing cost: ~zero today (nothing embeds). Tool overhead: 73 tool definitions (~5–8k tokens) sent every turn when native tools on — cacheable (90% off) or prunable (dynamic selection). Secondary waste: duplicated conversation entries in long-term memory (storage + recall pollution, §5).

## 17. Scalability — Rating: C+

- Single-user-first by design; `defaultUserId` pattern. Multi-tenant would require: session store isolation (exists per-workspace), auth (exists as plugin), and removing whole-file JSON write patterns (§5 — last-writer-wins data loss under concurrency).
- Worker + gateway + NATS option means the horizontal-scaling skeleton exists at Level 3. Queue-backed detached runs exist (`apps/worker`).
- Verdict: correct posture for a local-first product. Do not build multi-tenant now; do fix the concurrent-write hazards, which bite even one user with two channels active.

## 18. Code Quality — Rating: B-

- Strengths: consistent zod-at-the-edges, ports in core, small files as norm, TS strictness, clean naming.
- Issues: silent `catch {}` (recurring), `Object.assign(this.ctx, partial)` mutable context in `ToolGateway.mergeContext` (hidden shared state), 700+ line composition root, `as unknown as Record<string, unknown>` checkpoint cast (type hole on the persistence boundary — checkpoint schema should be zod-validated on read, `readRunCheckpoint` should be checked), stringly-typed `phase` progress events.
- Dead-code candidates: `tools/legacy.ts`, `hermes-tools.spec.ts` naming, phase-priority docs (52–59) that read as completed planning artifacts.

## 19. Missing Enterprise Features — Gap Table

| Feature | Status | Priority |
|---|---|---|
| Prompt caching | ADR only | P0 |
| Context window management | ADR only | P0 |
| Structured logging/tracing | missing | P0 |
| Eval framework (golden trajectories) | raw material exists | P1 |
| Prompt registry/versioning | missing | P1 |
| Per-tool policy (timeout/retry/approval) | partial (approval in code) | P1 |
| Guardrails / injection defense on tool output | missing | P1 |
| Retry strategy (model calls) | fallback chain exists; per-call retry unclear | P1 |
| Semantic cache | missing | P2 |
| Hybrid search / reranker | no RAG yet | P2 |
| Memory TTL/pruning/ranking | missing | P2 |
| Cost dashboard | token audit exists, no UI | P2 |
| Audit trail | partial (sessions.jsonl) | P2 |
| Knowledge versioning / freshness | missing | P3 |
| Knowledge graph | missing | P3 |
| Feature flags | missing | P3 |
| Fine-grained permissions | missing (single-user) | P3 |
| Model routing / fallback / multi-provider | **exists** — ahead of peers | — |
| Workflow engine / planner | **exists** (DAG + task-planner) | — |
| Reflection/self-critique | **exists** (learning loop) | — |

## 20. Roadmap

### P0 — do now (weeks, not months)

| # | Item | Why | Effort | Risk | Gain |
|---|---|---|---|---|---|
| 1 | Implement ADR-0010 layer 2: Anthropic prompt caching | Pure cost win, no behavior change | 0.5–1 d | Low | 40–70% input-token cost on cached blocks |
| 2 | ADR-0010 layer 1: sliding window + summarize | Unbounded history is the top waste + eventual context overflow crash | 2–3 d (summarizer exists) | Medium (summary quality) | 50–80% on long sessions |
| 3 | ADR-0010 layer 3: tool-output clipping | Large outputs poison + inflate context | 1–2 d | Low | 10–30% |
| 4 | Structured logging (pino) + token/cost/latency metrics per model call | Can't optimize or debug what isn't measured; silent catches hide failures | 3–4 d | Low | Enables everything above |
| 5 | Tests for agent tool loop + checkpoint/resume | Highest complexity × zero coverage; blocks safe refactors | 3–5 d | Low | Correctness |

### P1 — next quarter

| # | Item | Why | Effort | Depends on |
|---|---|---|---|---|
| 6 | Extract PromptAssembler / SkillActivator (cached trigger index) / ToolLoopEngine from `DefaultAgentRuntime` | Testability + kills per-turn catalog rescan | 1–2 w | P0-5 |
| 7 | Fix memory layer: stop mirroring raw turns to long-term; session-indexed reads; recency-weighted recall; TTL | Cost + recall quality + privacy | 1 w | — |
| 8 | Per-tool policy in ToolGateway spec (timeout/retry/approval/scope) | Enterprise control plane; approval machinery already exists | 1 w | — |
| 9 | Prompt hash registry + version in session metadata | Cheap, unlocks evals | 2 d | — |
| 10 | Tool-output injection framing (data-not-instructions delimiters) | Cheapest meaningful security win | 2 d | — |
| 11 | Golden-trajectory eval harness in CI (replay via mock provider) | Regression net for prompts/loop changes | 1–2 w | 9 |

### P2 — this year

12. Level-1 honest RAG: hash-based incremental ingest + FTS5/BM25 retrieval + heading-aware chunking; add embeddings/hybrid only after eval baseline (3–4 w).
13. Split `createPlatform` into lifecycle-managed subsystem factories; lazy init for CLI cold start (1–2 w).
14. Semantic cache for repeated queries; dynamic tool-definition selection (2 w, needs metrics from P0-4).
15. Cost dashboard in `apps/web` fed by token-usage audit (1 w).
16. Rate limiting + audit trail hardening in api/gateway (1 w).

### P3 — when justified by usage

17. Contextual retrieval + reranker (needs 12 + eval data).
18. Knowledge freshness/versioning, source priority, confidence scores.
19. Knowledge graph / entity extraction — only after retrieval evals show flat-retrieval ceiling.
20. Multi-tenant hardening (concurrent-write-safe stores, per-tenant isolation, fine-grained permissions).
21. Feature flags, distributed indexing.

---

## Industry Comparison (condensed)

- **vs Claude Code / Gemini CLI:** Anvio's approval-checkpoint resume is comparable-or-better; both competitors do aggressive context compaction and prompt caching that Anvio lacks (P0 items 1–3 close this).
- **vs LangGraph/Mastra:** those model the agent loop as an explicit graph — more testable/composable than Anvio's monolithic generator. P1-6 moves toward this without adopting a framework.
- **vs LlamaIndex:** its entire value is the ingestion/retrieval pipeline Anvio stubs. Don't port it; build the minimal BM25-first version (P2-12) with evals.
- **vs OpenWebUI/CrewAI:** Anvio's provider routing, fallback chains, runtime abstraction (9 backends), and channel breadth exceed both. That breadth is the moat — protect it with tests, don't extend it further until P0/P1 land.
- **vs DSPy:** prompt versioning + eval loop (P1-9/11) is the pragmatic 20% of DSPy worth having.

## Closing Note

Anvio's shape is right and its breadth is impressive. vNext should be a **depth release, not a breadth release**: token economics, tests, memory honesty, and measurement. Every P0 item is either pure cost reduction or pure risk reduction with no user-visible behavior change — the safest possible quarter of work with the largest ROI.
