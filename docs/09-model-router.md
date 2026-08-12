# Model Router

`packages/models` is Anvio's Model Gateway. Per [ADR-0013](adr/0013-model-gateway-evolution.md) it evolves in place — no separate `packages/model-gateway/` package. All model calls from `packages/agents`, `packages/platform`, and `apps/cli` route through this package's `ModelRouter` (or the raw `ModelProviderRegistry` for direct-provider paths).

## ModelProvider port

Adapters implement `ModelProvider` from `@anvio/core/ports/model-provider.port.ts`:

```ts
interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  tools?: ModelToolDefinition[];
  signal?: AbortSignal;   // wired through all adapters (v1.26.0)
}
interface ModelProvider {
  readonly providerId: string;
  readonly supportsNativeTools?: boolean;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  embeddings?(texts: string[]): Promise<number[][]>;
}
```

## Shipped adapters (18 providers)

- **Anthropic** — native SDK, prompt caching ([ADR-0010 Layer 2](adr/0010-token-optimization.md)), native `tool_use`
- **Gemini** — REST, native `functionDeclarations` (v1.25.0)
- **OpenAI-compatible** — one adapter covers: `openai`, `openrouter`, `deepseek`, `groq`, `mistral`, `together`, `xai`, `fireworks`, `moonshot`, `cerebras`, `sambanova`, `perplexity`, `cohere`, `huggingface`, `ollama`, plus arbitrary `custom` endpoints

Provider specs live in `packages/models/src/provider-catalog.ts`. Env-var-driven registration via `createModelProviderRegistryFromEnv`.

## Routing (`workspace/providers/routing.yaml`)

`ModelRouter.chat()` selects a target using this precedence chain (per [ADR-0011](adr/0011-model-provider-auth-and-switching.md) D2):

1. Agent frontmatter `spec.model.override.{provider,model}` — hard win
2. Task-classifier route (`coding | fast | reasoning | vision | embed | rerank | research | review`) mapped to `routes[<name>]`
3. Route `primary` + `fallback[]` chain via `walkFallbackChain`

```yaml
# workspace/providers/routing.yaml
spec:
  routes:
    coding:
      primary: { provider: anthropic, model: claude-sonnet-4-20250514 }
      fallback:
        - { provider: openai, model: gpt-4o }
        - { provider: groq, model: llama-3.3-70b-versatile }
    fast:
      primary: { provider: groq, model: llama-3.3-70b-versatile }
    review:
      primary: { provider: anthropic, model: claude-opus-4-20250514 }
    research:
      primary: { provider: perplexity, model: sonar-pro }
```

CLI: `anvio routing show|providers|catalog|test [route] [--input msg]`.

## Fallback + circuit breaker

`walkFallbackChain(route, execute, options)` (`packages/models/src/fallback-chain.ts`) walks `[primary, ...fallback]` and retries on errors matching `429|rate limit|timeout|503|502` (default `isRetryable`).

Since v1.27.0, `options.breaker?: ProviderCircuitBreaker` adds health-aware skipping:

| State | Behavior |
|---|---|
| `closed` | Calls pass through; failures increment counter |
| `open` | Skip — `attempts[].skipped = 'circuit-open'`; next fallback is tried |
| `half-open` | One probe permitted after `cooldownMs`; success closes, failure re-opens |

Defaults: `failureThreshold: 3`, `cooldownMs: 30_000`. Non-retryable errors do NOT open the circuit (client bug ≠ provider health).

## Spend budget

`SpendBudgetLedger` (`packages/models/src/spend-budget.ts`) tracks USD per key with hard-error enforcement:

```ts
const ledger = new SpendBudgetLedger();
ledger.setCap('tenant:acme', 100);   // 100 USD cap
const router = new ModelRouter({ storage, providers, spendBudget: ledger });
await router.chat({ messages, budgetKey: 'tenant:acme' });
// After the call: ledger.charge('tenant:acme', estimatedUsd).
// Throws AnvioError code MODEL_SPEND_BUDGET_EXCEEDED (HTTP 402) if next call would breach.
// Failed charges are NOT recorded — prior spend stays exact.
```

Cost is computed via `estimateModelCostUsd(provider, model, usage)` using the `ModelDescriptor` registry (see below). Unknown models silently skip the charge — the router still returns the response.

## ModelDescriptor registry

`packages/models/src/model-descriptor.ts` — capability + pricing metadata per `(provider, model)`:

```ts
interface ModelDescriptor {
  provider: string; model: string;
  contextWindow: number; maxOutput: number;
  supportsTools: boolean; supportsCaching: boolean;
  cost?: { input: number; output: number; cacheRead?: number; cacheCreation?: number };
}
```

Cache tokens default to Anthropic-style rates: `cacheRead = input * 0.1`, `cacheCreation = input * 1.25`, overridable per descriptor. Ships 9 seed descriptors (Anthropic Sonnet/Opus/Haiku 4, OpenAI 4o/4o-mini, Gemini 2.0 Flash / 1.5 Pro, DeepSeek chat, Groq Llama-3.3). Missing descriptors are advisory — router still calls the provider; `estimateModelCostUsd` returns `undefined` and the spend charge is skipped.

## Metrics

Every `chat()` and completed `stream()` emits per-call metrics via `@anvio/observability` — see [13-observability.md](13-observability.md):

- `anvio_tokens_input_total`, `anvio_tokens_output_total`, `anvio_tokens_total`
- `anvio_tokens_cache_read_total`, `anvio_tokens_cache_creation_total` (Anthropic prompt caching)
- `anvio_model_calls_total`
- `anvio_model_call_latency_ms` histogram (count/sum/min/max)

## Credential pools

`packages/credentials` — encrypted per-tenant key pools stored under `workspace/credentials/`. `RouteTarget.pool` in `routing.yaml` acquires a key from the named pool per request (see [ADR-0011 D5](adr/0011-model-provider-auth-and-switching.md)).

## Deferred (see [ADR-0013](adr/0013-model-gateway-evolution.md))

- `routing.yaml` hot-reload (currently reads once at startup)
- Web UI for provider key management
- Extraction into `packages/contracts` when Epic 0 kernel scaffolding lands
