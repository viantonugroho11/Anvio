# 06 — Error Handling & Reliability

## 1. Patterns observed

| Pattern | Count / location | Verdict |
|---|---|---|
| `catch {` (no binding) | 149 in non-spec source | Mostly "best-effort, ignore" with a comment. Satisfies `no-empty` but hides failures (CQ-012). |
| Typed result objects `{ status: 'failed', error: string }` | tools, MCP, harness | Consistent at the tool boundary; loses error class / retryability. |
| `AnvioError(code, message)` | `core`, used in models/runtimes | Good primitive, inconsistently adopted. |
| Provider error normalization (`readProviderErrorDetails`) | `models/src/provider-error.ts` | Best-designed error path in the repo: retryable flag set at source, consumed by fallback chain and breaker. |
| Per-handler isolation | `LocalEventBus.dispatch` (`local-event-bus.ts:60-70`), Telegram per-update try/catch, `runGuarded`, `deliver()` | Good isolation; failures logged with `console.error` only. |
| Process guard | `installProcessErrorGuards` | Prevents one rejection from killing every channel (T-005). |
| Error → string conversion | `error instanceof Error ? error.message : String(error)` repeated widely | Stack traces dropped at almost every boundary; `cause` never set. |

## 2. Propagation and traceability

An error in a tool deep inside a turn is (1) caught in the builtin case → `{status:'failed', error: message}` → (2) formatted into a tool-result message for the model → (3) never logged. A provider error becomes an `error` chunk → `DefaultAgentRuntime.run` wraps it in a fresh `Error` (`runtime.ts:108`, stack and class lost) → orchestrator logs `message`. A storage write failure in the runtime `finally` is discarded entirely (`runtime.ts:401-403`).

Result: **an engineer cannot trace most failures from origin to final handling point without reproducing them.** There is no error ID, no run ID in logs, and no structured fields (CQ-018).

## 3. Retryable vs non-retryable

- Models: classified correctly (fallback chain + breaker).
- Channels HTTP: 429/5xx retried with `Retry-After` (`fetch-retry.ts`).
- Orchestrator: retries everything when `onFailure: 'retry'` (CQ-010).
- Tools: no classification; the model decides whether to retry by reading the error string.

## 4. Timeouts, retry limits, backoff

Covered in `04` §2. Summary: model streams and several subprocess paths lack timeouts (CQ-006, CQ-027); reconnects lack backoff (CQ-008); orchestrator backoff lacks jitter.

## 5. Recovery after partial failure

| Scenario | Current behaviour | Finding |
|---|---|---|
| Provider dies mid-stream | Partial text kept with notice; tool loop skipped | Good |
| Provider dies before first chunk | Router fails over to next target | Good |
| Tool batch interrupted by approval | Completed results lost; re-execution likely | CQ-004 |
| Iteration cap reached | Silent completion | CQ-005 |
| Process killed mid-write | Truncated JSON; `read()` returns `null` → session appears new/empty | CQ-014, CQ-012 |
| Process killed mid-turn | No in-progress marker; user message may be lost (finally does not run) | 05 §1 |
| Sub-agent pauses for approval | Counted as completed | CQ-010 |
| Channel socket drops | Reconnect after 5 s; if reconnect's `start()` throws, adapter dead until restart | CQ-008 |
| Malformed `tools/gateway.yaml` | Defaults silently applied | CQ-012 |
| A2A enabled but boot fails | Feature absent, no log | CQ-012 |
| Learning hook fails | Event bus isolates and logs | Acceptable |

## 6. Failure isolation across components

- **Tools → runtime:** isolated (tool failure becomes a message), except `onToolCompleted` hook exceptions which escape `ToolGateway.call` after the side effect (CQ-032).
- **Plugins (MCP) → runtime:** isolated by result mapping; stdio respawn.
- **LLM provider → other sessions:** breaker is process-wide by provider id — one tenant's bad key could open the circuit for all sessions using that provider. **MEDIUM confidence**: whether auth errors (401) count as retryable failures was not verified in every adapter; `walkFallbackChain` records failures only for retryable errors (`fallback-chain.ts:55-57`), which should exclude 401.
- **Channels → each other:** unhandled-rejection guard + per-handler isolation keep one adapter's failure from killing others. However, because the local bus is serial (CQ-007), a *slow* handler degrades all adapters sharing the publish path.
- **Memory failure → turn:** read failure in `getContext` throws into the runtime catch → turn errors (visible). Write failure after a successful answer throws from `storeConversation` (`runtime.ts:379`) → the user already saw the answer but the turn ends with an `error` chunk and `unfinishedTurnHistory` is still set, so the `finally` writes the history *without* the assistant answer. Net effect: answer shown, not remembered. LOW frequency, HIGH confusion.

## 7. Duplicate side effects

Sources of duplicates confirmed in code: approval-resume re-execution (CQ-004), orchestrator retry re-running a sub-agent whose tools already acted (CQ-010), `onToolCompleted` failure prompting a model retry (CQ-032), long-term memory double writes (CQ-021), progress double publish (CQ-020). No idempotency keys exist for any outbound side effect (channel sends, HTTP requests, file writes).

## 8. Recommendations (ordered)

1. Introduce `errorMessage(e)` + `logError(logger, e, ctx)` helpers and replace silent `catch {}` on **config and persistence** paths first (gateway.yaml, storage read/write, A2A boot, runtime `finally`). Keep "best-effort" catches only where the comment names why loss is acceptable, and log at `debug` there.
2. Preserve causes: `throw new AnvioError(code, msg, { cause: err })`; stop re-wrapping errors in `DefaultAgentRuntime.run` — yield/throw a typed error carrying `retryable`.
3. Fix CQ-004 and CQ-010 retry classification together; they are the main duplicate-side-effect sources.
4. Atomic writes (CQ-014) + distinguish ENOENT from parse errors in `readJson`.
5. Add an "in-progress turn" marker in session metadata at turn start; on worker boot, mark stale ones `interrupted` and notify the channel.
