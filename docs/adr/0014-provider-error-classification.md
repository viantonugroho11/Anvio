# ADR-0014: Provider error classification — decide retryability at the wrap site

## Status

Accepted — shipped in `packages/models/src/provider-error.ts`. Closes the "typed provider errors" gap named in ADR-0013 D1.

## Context

All three model providers wrapped every failure in an `AnvioError` carrying a **constant** message:

| Provider | Wrapper before this ADR |
|---|---|
| `anthropic.provider.ts:127` | `'Anthropic API call failed'` |
| `gemini.provider.ts:79` | `'Gemini API call failed'` |
| `openai-compatible.provider.ts:129` | `` `${this.providerId} API call failed` `` |

`AnvioError` (`packages/core/src/errors/anvio-error.ts:26`) forwards the original error to `cause`, so the HTTP status, the provider's `error.type`, and the request id survived only on `.cause` — where nothing read them.

Meanwhile `walkFallbackChain` decided retryability by pattern-matching the message (`fallback-chain.ts:71-73`):

```ts
const message = error instanceof Error ? error.message : String(error);
return /429|rate limit|timeout|503|502/i.test(message);
```

That regex was tested against those constant strings and could never match. Two consequences followed, both silent:

1. **No provider error was ever retryable.** `fallback-chain.ts:62` took the `!isRetryable(error)` branch on the first target and rethrew, so a configured fallback target was never tried — not for a 429, not for a 529.
2. **The circuit breaker never recorded a failure.** `breaker?.recordFailure()` at `fallback-chain.ts:56` sits behind the same predicate, so a provider could fail indefinitely without its circuit opening.

A third defect fed the first: both raw-fetch providers called `response.json()` *before* checking `response.ok`. An error response is frequently not JSON — a proxy's HTML page, a plain-text gateway message — so the parse threw and the status was lost before anyone could classify it.

### Why "just honour `statusCode`" is the wrong fix

The obvious repair is to read `AnvioError.statusCode` instead of the message. It is a trap. `AnvioError.defaultStatusCode` maps `MODEL_PROVIDER_ERROR` to **502** (`anvio-error.ts:52-55`), and 502 is retryable. Every unclassified provider failure — a bug in our mapping code, a malformed response, a programming error inside the try block — would present as a retryable upstream outage and burn the whole fallback chain.

The information needed to classify a failure exists at exactly one place: the `catch` that first sees the typed SDK exception or the raw HTTP status. It must be recorded there, not re-derived later.

## Decision

### D1 — `ProviderErrorDetails` carries an explicit `retryable`, decided at the wrap site

A new `packages/models/src/provider-error.ts` defines the shape attached to `AnvioError.details`:

```ts
export interface ProviderErrorDetails {
  provider: string;
  status?: number;      // absent for transport-level failures
  type?: string;        // provider error type, or a synthetic kind
  requestId?: string;
  retryable: boolean;   // decided where the evidence still exists
}
```

`toProviderError(provider, error)` normalises anything thrown, branching on the Anthropic SDK's typed exceptions — `APIUserAbortError`, `APIConnectionError`, `APIError` — which the SDK exports from its package root. Classification:

| Input | `retryable` | Rationale |
|---|---|---|
| `APIUserAbortError`, or any `Error` named `AbortError` | `false` | A user stop is not a provider fault; failing over would restart work the user cancelled. |
| `APIConnectionError` | `true` | Transport failure; another target may be reachable. |
| `APIError` with status | `isRetryableStatus(status)` | 408/409/425/429 and everything ≥ 500. |
| Anything else | `true` | `fetch failed`, socket reset, DNS — worth another target. |

`httpProviderError(provider, status, body)` covers the raw-fetch providers, which have a status but no typed exception.

The status also becomes `AnvioError.statusCode`, so the API layer maps provider failures to a truthful HTTP code instead of a blanket 502 — but **nothing derives retryability from it**.

### D2 — Read the status before parsing the body

Both raw-fetch providers now check `response.ok` and read `await response.text()` *before* any `.json()`. A non-JSON error body degrades to a message string rather than destroying the status.

### D3 — `defaultRetryable` reads details, and keeps the regex as a fallback

```ts
const details = readProviderErrorDetails(error);
if (details) return details.retryable;
// non-provider errors keep the previous message-matching behaviour
```

`readProviderErrorDetails` walks the `cause` chain (bounded at depth 10), so an error re-wrapped by an outer layer still classifies correctly. The regex branch is retained deliberately: route resolution, budget guards, and plain `Error`s from callers never carry provider details, and changing their behaviour is out of scope.

### D4 — Streaming still yields an error chunk; it does not throw

`stream()` in all three providers continues to yield `{type:'error'}` rather than throwing. It now yields the **classified** message, so the string a user sees names the status. Making streamed calls throw — and routing them through `walkFallbackChain` via a new `ModelRouter.stream()` — is a separate, larger decision and is **not** taken here.

## Honest scope

This ADR fixes classification. It does not make failover work end to end, and the ADR should not be read as claiming it does:

- `ModelRouter` exposes only `chat()`; there is no `stream` method in `model-router.ts`. The agent loop calls `modelProvider.stream()` directly (`packages/agents/src/runtime.ts:199`), so the primary execution path does not enter the fallback chain at all.
- `model-router.ts:104` calls `walkFallbackChain` **without** a `breaker`, so `breaker?.recordFailure()` remains a no-op on the chat path too. The circuit breaker is not wired into the router — a separate gap from the one this ADR closes.
- The fallback chain itself is only reachable when a `providers/routing.yaml` exists; `model-router.ts:89-102` bypasses it otherwise.

What changes today: error messages name the status, `AnvioError.statusCode` is truthful, and when the chain *is* reached, it fails over correctly.

## Consequences

**Positive**

- One classification path for all three providers; adding a fourth means calling `toProviderError` in its `catch`.
- Retryability can no longer regress by someone rewording an error message.
- The 502-default trap is structurally impossible to fall into: `readProviderErrorDetails` returns `undefined` for an unclassified `AnvioError`, so it takes the regex branch rather than being read as a retryable 502. Pinned by a test.
- `requestId` is preserved on Anthropic failures, which is what Anthropic support asks for first.

**Negative**

- `packages/models` now imports `@anthropic-ai/sdk` in shared, non-Anthropic code, so the Gemini and OpenAI-compatible paths carry a dependency on it for the `instanceof` checks. Acceptable while it is the only vendor SDK in the repo (see ADR-0013); if a second lands, the typed-exception branch should move behind a per-provider mapper.
- Two classification mechanisms coexist (details, then regex). The regex branch is dead weight once every throw site is classified, but removing it now would silently change behaviour for non-provider errors.

## Cross-references

- ADR-0013: `packages/models` **is** the Model Gateway — this closes the typed-error slice of its D1 gap table.
- ADR-0011: model provider auth and switching — `routing.yaml` is the config surface that makes the fallback chain reachable.
- ADR-0010: token optimization — unaffected; prompt caching sits on the success path.
