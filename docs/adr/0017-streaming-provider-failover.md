# ADR-0017: Streaming provider failover, bounded by committed output

## Status

Accepted — shipped in `packages/models/src/model-router.ts`, `packages/agents/src/runtime.ts`, and `packages/platform/src/index.ts`. Supersedes the routing claims in ADR-0011; see D5.

## Context

`ModelRouter` read like production infrastructure — `routing.yaml`, a fallback chain, a circuit breaker, credential pools — and none of it ran on any path a user request took. Four facts, each verified against the code:

| Documented | Actual |
|---|---|
| The router handles model calls | `ModelRouter` had **no `stream` method at all**. `packages/agents/src/runtime.ts` calls `modelProvider.stream()` directly, and it is the only model call in the agent loop. |
| The router is on the request path | `createModelRouter` was constructed in exactly one place: `cmdRouting` in `apps/cli/src/main.ts` — the `anvio routing show\|providers\|catalog\|test` command. |
| A circuit breaker protects providers | `ProviderCircuitBreaker` had **zero construction sites** outside its own spec. `model-router.ts` called `walkFallbackChain` with no options, so `breaker` was `undefined` on the chat path too. |
| The router rotates credential pools | `credentialPools` was **never supplied**. ADR-0011 states "the router calls `credentialPools.acquire(poolId)`". It did not. |

The router was not broken; it was unreachable. The cost of that was not a runtime failure but a documentation failure: a provider audit of this repo flagged "fallback chain inert" and "circuit breaker never opens" as resilience defects, when in truth there was no resilience to defeat. Meanwhile the real behaviour — an Anthropic 529 killing the user's session outright — was invisible in the docs.

The choice was to correct the documentation or to build the thing it described. **The product owner chose to build it.**

## Decision

### D1 — Failover is bounded by committed output

`ModelRouter.stream()` fails over only when a target dies **before emitting anything**.

This is the load-bearing constraint, not an implementation detail. Once a `text_delta` or `tool_use` has been yielded it is on the user's screen and cannot be retracted; silently continuing from a different model would splice two voices into one answer with no seam the user can see. So the failover window closes at first content, and any later failure is surfaced as-is.

### D2 — Candidates are primed, and the priming is replayed

To make that window exist, `primeStream` advances each candidate until the call proves itself — first content, a terminal error, or completion — and keeps every chunk it consumed. On success those chunks are replayed to the caller, so priming costs no discarded output and no duplicated request.

The alternative was to fail over at any point and accept torn output. Rejected under D1.

### D3 — Adapters classify; the router routes

Streaming adapters report failures as `error` chunks rather than throwing, and `walkFallbackChain` only reacts to exceptions. Rather than change every adapter's contract, `StreamChunk`'s error variant gains `retryable?: boolean`, populated at the adapter from the same classification ADR-0014 introduced, and `primeStream` lifts a retryable chunk back into an exception.

`retryable` is deliberately **not** derived from the message text. Undefined means "do not fail over": a frame error with no HTTP status (a context-length rejection, say) would only fail the next target too.

### D4 — No `routing.yaml`, no behaviour change

`stream()` takes an optional `directProvider`. With no route configured the router streams from the caller's already-resolved provider — the agent's own, honouring frontmatter — rather than an arbitrary first map entry. A Level-1 workspace therefore behaves exactly as it did before the router existed, which is what makes this safe to wire on by default.

`packages/platform` supplies the router to `DefaultAgentRuntime` along with the first `ProviderCircuitBreaker` ever constructed in production code.

### D5 — What ADR-0011 now gets right, and what it still does not

ADR-0011's routing and fallback description becomes true with this change. Its credential-pool claim does **not**: `credentialPools` is still never supplied, and `model-router.ts` still discards the acquired key (`resolveProvider` returns the registered provider before the key is used). That is Phase 5b work, gated behind securing `apps/api`. ADR-0011 is annotated rather than rewritten, so the gap stays visible instead of being quietly closed.

## Consequences

**Positive**

- A provider outage that lands before the first token is now invisible to the user, on the path users actually take.
- The circuit breaker runs, on both `chat` and `stream`. A provider failing repeatedly is skipped rather than retried into.
- `routing.yaml` — shipped by `anvio init` since the beginning — finally does something.

**Negative**

- ~~**A mid-answer failure is still a dead session.**~~ **Addressed (issue #20).** The turn is no longer discarded: `runtime.ts` keeps the generated text, appends a visible interruption notice, and ends cleanly instead of throwing. The underlying limit stands — failover itself still cannot cross the first content chunk — but the cost of hitting it is now a short answer rather than a lost one.
- ~~**Nothing surfaces which target served the request.**~~ **Addressed (issue #21).** `StreamChunk` gains a `failover` variant that the router emits before any content, and the `done` chunk carries `provider` / `model`. The agent runtime renders the switch as a progress event, deliberately not spliced into the answer text.
- **Answers can still come from a model the user did not choose**, with different phrasing, formatting, and refusal behaviour. Announcing the switch makes it visible; it does not make it consented to. A per-route "never fail over" opt-out is the natural next control.
- Priming adds one `await` before the chain commits. In practice that is the latency already required to reach the first token, not new latency — but a provider that buffers heavily before its first chunk will hold the whole chain open.
- The router now sits on the hot path, so a bug in `primeStream` breaks every agent turn rather than only `anvio routing test`. The eight tests in `model-router-stream.spec.ts` are the guard.

## Cross-references

- ADR-0011: model provider auth and switching — routing claims corrected here; credential-pool claim still outstanding (D5).
- ADR-0013: `packages/models` is the Model Gateway — closes its "circuit breaker per provider" gap.
- ADR-0014: provider error classification — supplies the `retryable` signal D3 depends on.
- ADR-0016: token accounting — `stream()` charges the spend ledger from the `done` chunk's usage, using the same disjoint-bucket split.
