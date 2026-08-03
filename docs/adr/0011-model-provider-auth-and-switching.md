# ADR-0011: Model Provider Authentication and Runtime Switching

## Status

Accepted

## Context

Anvio routes agent conversations through one of 18 model providers (Anthropic, OpenAI, Gemini,
Groq, DeepSeek, OpenRouter, Mistral, Together, xAI, Fireworks, Moonshot, Cerebras, SambaNova,
Perplexity, Cohere, HuggingFace, Ollama, custom). Two distinct concerns arise:

1. **How do providers authenticate?** — each provider has its own credential mechanism.
2. **How does the system select and switch providers at runtime?**

These are frequently conflated. ADR-0009 covers *runtime OAuth* (vendor-CLI runtimes such as
Claude Code Agent SDK, Cursor, Codex). This ADR covers model provider auth and dynamic routing
for the *local runtime*'s direct SDK/HTTP tool loop.

### Two auth layers — do not conflate

| Layer | Mechanism | Providers |
|-------|-----------|-----------|
| **Model API key** | env var or credential pool | Anthropic, OpenAI, Gemini, all OpenAI-compatible |
| **Runtime OAuth** | `anvio setup-token --claude\|--cursor\|--codex` (ADR-0009) | Claude Code Agent SDK, Cursor, Codex, Antigravity, Nous |

Setting `ANTHROPIC_API_KEY` in the same environment as `runtime.provider: claude-code` silently
bills API credits instead of using the subscription. The distinction is enforced throughout
`packages/runtimes` and `packages/models`.

### Current switching mechanism

Provider selection follows a priority chain on every request:

```
1. agent frontmatter override    (model.override.provider + model.override.model)
2. task-classifier route         (coding / fast / review / research / default)
3. routing.yaml fallback chain   (primary → fallback → fallback …)
4. first registered provider     (last resort)
```

`packages/models/src/model-router.ts` implements this chain. `packages/models/src/task-classifier.ts`
maps inbound message + agent skills + skill routing hints to a named route.

`packages/models/src/fallback-chain.ts` walks the fallback list for a route and returns the first
successful response, setting `failover: true` on the response when a non-primary provider was used.

### Provider registration

`createModelProviderRegistryFromEnv()` reads env vars at startup and registers every provider
whose API key is present. Ollama registers if `OLLAMA_BASE_URL` or `OLLAMA_ENABLED=true`.

Credential pools (`packages/credentials`) allow key rotation: the router calls
`credentialPools.acquire(poolId)` and constructs a provider on the fly for each request when
`target.pool` is set in `routing.yaml`.

### Gaps at time of writing

- No web UI to add, test, or revoke provider API keys at runtime.
- No per-session provider override via CLI flag (must change `routing.yaml` or agent frontmatter).
- Gemini provider does not use native `function_calling` (`supportsNativeTools` is false); it falls
  back to fenced `anvio_tool` blocks.
- No hot-reload of `routing.yaml`; changes require a process restart.

## Decision

### D1 — Two-layer auth remains the canonical model

Model API keys are environment variables or credential pool entries. Runtime OAuth tokens are
separate artifacts stored under `workspace/connections/`. Code and docs must not conflate them.

### D2 — Provider selection order is fixed

The four-step priority chain above is the authoritative order. No implicit fallback may bypass it.
Explicit `model.override` in agent frontmatter always wins over routing config.

### D3 — `routing.yaml` is the operator's knob for provider switching

Operators switch the active provider by editing `workspace/providers/routing.yaml`.
Per-agent overrides in agent `.md` frontmatter are the developer's knob for single-agent
exceptions.

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

### D4 — CLI surface for provider inspection

```bash
anvio routing show               # print active routing.yaml
anvio routing providers          # list registered providers
anvio routing catalog            # list all supported providers + env vars
anvio routing test [route]       # send a test message through a route
```

These commands are the primary operational tool for verifying provider connectivity before deploying
an agent.

### D5 — Credential pools for key rotation

When `target.pool` is set in `routing.yaml`, the router acquires a key from the named pool on each
request. Pools are managed via `packages/credentials` and stored encrypted under
`workspace/credentials/`. This is the recommended pattern for production deployments with multiple
API keys.

### D6 — Deferred: web UI for provider management

A browser-based key management UI is deferred. Until then, operators use env vars or credential
pools configured via CLI.

### D7 — Deferred: Gemini native tools

`GeminiProvider.supportsNativeTools` remains `false`. Gemini conversations use fenced `anvio_tool`
blocks. Native `function_calling` will be added in a future phase when the Gemini SDK's tool loop
is stable.

### D8 — Deferred: hot-reload of routing.yaml

`ModelRouter.loadRouting()` reads the file once at startup. A file-watcher reload is deferred.
Operators must restart the process to apply routing changes.

## Consequences

- Any code that needs to know the active provider must call `ModelRouter.chat()` and inspect
  `result.selectedProvider` — never hardcode a provider name.
- `ANTHROPIC_API_KEY` must not be set when `runtime.provider: claude-code` is configured.
- Adding a new provider requires: entry in `OPENAI_COMPATIBLE_PROVIDER_SPECS` (or a new
  `ModelProvider` implementation), case in `createModelProvider`, and registration in
  `createModelProviderRegistry`. No other files need to change.
- Gemini users must use the fenced tool format until D7 is implemented.
