# 05 — AI Agent-Specific Code Quality

Coverage: `agents` (full read), `models` router/fallback/breaker (read) + providers (signal/timeout scan), `tools` gateway (full) + network/fs/exec builtins (read), `skills` composable executor (read), `memory` fs + provider-factory (read), `harness` tool port + approval producer (read), `channels` base + Discord/Slack/Telegram lifecycle (read), `learning` gate (read). `runtimes` vendor adapters, `a2a`, `acp`, `workflows`, `goals`, `automation` were **scanned only**.

## 1. Agent runtime (`packages/agents`)

**Strengths**
- Provider-agnostic loop over a typed chunk stream; native `tool_use` and fenced `anvio_tool` blocks supported behind one interface (`runtime.ts:176-183`).
- Hard iteration ceiling exists (`DEFAULT_MAX_TOOL_ITERATIONS = 5`, configurable) — prevents infinite tool loops.
- Careful partial-failure semantics: truncation notice on `max_tokens`/`length` (`:270-273`), interrupted-stream notice keeps already-shown text (`:280-293`), and history is preserved when a turn does not complete (`:200-204`, `finally` at `:391-405`). These came from past incidents and are well commented.
- Route selection is explicit, never inferred from user text (`explicitRoute`, `:485-494`) — removes a whole class of surprising provider switches.

**Defects**
- Silent loop exhaustion (CQ-005).
- Approval pause drops executed tool results (CQ-004); same bug duplicated across both loop variants (CQ-025).
- Cooperative-only stop; no abort/timeout plumbing (CQ-006).
- Unchecked checkpoint cast (CQ-023).
- Errors inside optional prompt sources (skills, goals, triggers, soul) are swallowed, so the effective system prompt silently differs from configuration (CQ-012). No log or progress event records which skills/soul were actually applied.
- Lifecycle state is implicit: no `RunState` type; transitions are spread across worker (`sessions.update({status})`) and runtime chunk types. Recovery after process crash mid-turn relies on the `finally` write, which does not run on SIGKILL/OOM; no "turn in progress" marker exists to detect and repair an interrupted run on restart.

**Orchestrator** (`orchestrator.ts`): DAG ordering via `task-planner` with dependency skip semantics is a solid base. Defects in CQ-010 (approval status ignored, unclassified retries, unbounded fan-out and nesting, floating publish). Fan-in synthesis runs the manager agent on the manager's own session (`:189-191`), appending a synthetic "Synthesize subagent results" user turn into the user-facing history — likely surprising (MEDIUM confidence, behaviour not exercised).

## 2. LLM integration (`packages/models`)

**Strengths**
- Clean provider contract; adapters normalize errors with `retryable` at the point where HTTP status / SDK error class is known (`provider-error.ts`).
- Router fails over only before the first content chunk (`model-router.ts:251-290`) — correct for streaming UX (no double answers).
- Per-provider circuit breaker, spend budget (`spend-budget.ts`), credential pools with rotation, model descriptors for context limits.
- Good test density (12 spec files, incl. stream, pools, budget, catalog wiring).

**Defects / debt**
- Half-open breaker admits a thundering herd (CQ-022).
- `walkFallbackChain` legacy overload (02 §7).
- Accounting attributes usage to the platform default provider (CQ-019).
- No idle timeout on streaming HTTP for OpenAI-compatible providers (CQ-006).
- Context window handling: `model-descriptor.ts` carries limits, and memory has a sliding-window summarizer (`provider-factory.ts:103`, `summarizeOnOverflow`), but the runtime sends `memoryContext.shortTerm` + tool results without token budgeting per iteration; tool outputs are clipped by characters (8 000) not tokens. Five tool rounds of 8 000 chars each can exceed small-context models. **MEDIUM confidence** — overflow path not exercised.

## 3. Tool execution (`packages/tools`, `harness`, `integrations`)

| Aspect | State |
|---|---|
| Registration / discovery | Config-driven enable flags in `tools/gateway.yaml`; definitions split across 5 places (03 §7) |
| Schema validation | JSON schemas sent to the model (`tool-schemas.ts`); **arguments not validated on receipt** — coerced with `String(x ?? '')` (04 §6) |
| Permission enforcement | Enable/disable per tool; MCP first-use approval; harness approval only when the model chooses to call `request_approval` (prompt instruction at `harness/src/runtime-tool-port.ts:62`). **No enforced approval for builtin mutating tools** (`edit_file`, `file_delete`, `run_shell`, `send_message`, `http_request` POST) |
| Egress / FS boundaries | No egress policy (CQ-002); prefix-bug containment (CQ-013); sandbox env leak (CQ-003) |
| Timeout | Per-tool where implemented (HTTP 15 s, sandbox 30 s); no gateway-level deadline |
| Cancellation | None (CQ-006) |
| Error classification | `status: 'failed' | 'skipped' | 'pending_approval'` + free-text `error`; no retryable/permanent distinction |
| Idempotency | None; combined with CQ-004 → duplicate side effects |
| Result serialization | `formatToolResultMessage` with char clipping — consistent |
| Concurrency | Sequential per round — safe |
| Recursion | Composable skills unbounded (CQ-009); `delegate_task`/`a2a_delegate`/`mixture_of_agents` disabled by default; depth limits for delegation **NOT VERIFIED** |

The single most important agent-specific gap is the **trust boundary between model output and side effects**: everything that makes a tool call safe today is either a default flag or a polite instruction in the system prompt. A prompt-injected page fetched by the default-enabled `web_fetch` can drive the default-enabled `http_request`.

## 4. Memory and context (`packages/memory`)

- Short-term vs long-term separation exists (`shortTerm.setMessages`, `longTerm.store`), FTS5 recall at Level 2, sliding-window summarization.
- Ownership of conversation state is split three ways (03 §2).
- Duplicate long-term writes and unbounded per-turn reads (CQ-021).
- Concurrent turns on one session lose history (CQ-007).
- Context leakage between sessions: recall is scoped by `userId` (`provider-factory.ts:84-85`) — cross-session recall for the same user is by design; cross-user leakage not observed.
- Persistence failure handling: final-history write failure in `finally` is swallowed (`runtime.ts:401-403`) with no log — a persistent disk error makes every session silently amnesiac.

## 5. Skills (`packages/skills`, `learning`)

- Catalog resolver + trigger cache with mtime-based reparse — sensible.
- Composable execution has no cycle/depth guard (CQ-009).
- Step `condition` strings are evaluated with `new Function` in the host process (CQ-034). Because skills are importable from external catalogs and auto-drafted by the learning loop, a skill file is effectively executable code with host privileges — the extension contract is far less safe than its YAML shape suggests.
- Runtime loads each agent skill definition on every turn (`runtime.ts:149-158`) through the catalog — cost scales with skills × turns; acceptable today, but a failure is swallowed per skill.
- Learning loop respects `soul.evolution.allowAutoUpdate` in both hooks (`learning/src/index.ts:104-110,176`) — the T-020 fix is in place. Drafted skills are written directly with `fs.writeFile` (`skill-evolution.ts:88,241`), not through the storage provider — bypasses containment and atomicity helpers.

## 6. Plugins / integrations (MCP, A2A)

- MCP is the extension mechanism; `McpToolPort.setCatalog` supports hot add/remove (ADR-0036). First-use approval is implemented (`mcp-tool-port.ts:39-51`).
- Plugin failure isolation: MCP stdio client respawns on failure (`mcp-stdio-client.ts:112,142`); A2A boot failure swallowed (CQ-012).
- Version compatibility: MCP SDK pinned at 1.30.0 with 3 high advisories (CQ-016).
- No formal plugin lifecycle (register/unregister/version) beyond MCP; `tool-bus` policy is unused (CQ-024).

## 7. Channels (`packages/channels`)

**Strengths:** common `BaseChannelAdapter` (stream buffering, message splitting, typing keep-alive, guarded dispatch); `fetchWithRetry` honours `Retry-After`; Telegram isolates per-update failures (issue #73); `channel-health.ts` exists.

**Defects:** stop/reconnect lifecycle (CQ-008); serial processing per poll loop and no per-session ordering (CQ-007); no inbound deduplication in Slack/Discord (Socket Mode / Gateway redeliver on reconnect — envelope IDs are not tracked; only Telegram's `update_id` offset gives at-most-once). Delivery failures are logged via `deliver()` (`gateway-worker.ts:50-62`) but not retried or surfaced to the user.

## 8. Agent-specific technical debt — summary

| Debt | Findings | Why it slows future work |
|---|---|---|
| Side-effect safety relies on model compliance | CQ-002, CQ-003, §3 | Every new mutating tool widens the blast radius |
| Agent loop concentrated in one generator | CQ-004/005/006, 02 §2 | Any loop change risks persistence/approval regressions |
| Three conversation-state representations | CQ-021, 03 §2 | Resume/learning/memory bugs recur |
| No run identity | CQ-018 | Cannot correlate channel message → run → tool → provider call |
| Recursion/concurrency limits ad hoc | CQ-009, CQ-010 | Learning-generated skills and nested plans can run away |
