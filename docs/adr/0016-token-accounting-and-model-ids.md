# ADR-0016: Token accounting invariant, and one source for model ids

## Status

Accepted — shipped in `packages/core/src/{types/common.ts,token-usage.ts,model-ids.ts}` and `packages/models`. Closes the cost-accounting and model-id slices of the ADR-0013 D1 gap table.

## Context

Three problems shared one root: nobody had written down what `TokenUsage.inputTokens` means, and model ids were restated as literals wherever they were needed.

### The inclusive-input invariant was never stated

`usageFromAnthropic` (`packages/models/src/providers/anthropic.provider.ts`) folds cache counts _into_ the input total:

```ts
const inputTokens = usage.input_tokens + cacheCreate + cacheRead;
```

So `inputTokens` is the whole prompt, and `cacheCreationInputTokens` / `cacheReadInputTokens` are a **breakdown** of it. Nothing said so, and two consumers got it wrong in opposite directions:

- `ModelRouter.chargeBudget` passed `inputTokens` _and_ both cache counts to `estimateModelCostUsd`, which adds them — so cached tokens were billed twice, once at full input rate and again at the cache rate.
- `addTokenUsage` (`packages/core/src/token-usage.ts`) dropped the cache fields entirely while summing. Accumulated usage therefore still carried cache tokens inside `inputTokens` with nothing left to identify them, so every downstream estimate billed cached reads at the full rate. The main accumulator silently violated the invariant it was accumulating.

### A duplicate price table shadowed the registry

`packages/platform/src/token-usage-audit.ts` carried its own three-entry `MODEL_COST_PER_1M` — sonnet, gpt-4o, gemini-flash — while `packages/models/src/model-descriptor.ts` held a nine-entry registry with cache-aware pricing. The audit table won on the path that feeds `anvio usage stats`, so the cost column was **silently blank** for every other model, deepseek and groq included. It also keyed on model alone, which cannot be right: the same model id is served at different prices by different hosts.

### Only two of four cache breakpoints were used

`buildSystem` cached the system prompt and `buildTools` cached the last tool definition. The conversation itself — which `packages/agents/src/runtime.ts` resends in full on every tool iteration, growing by an assistant turn plus N tool results each time — was never cached, so every prior turn was re-billed at full input rate on every iteration.

### Model ids were restated in eight places

`claude-sonnet-4-20250514` appeared as a literal in the Anthropic provider, the factory, the descriptor registry, `agent-md.ts`, the workspace scaffold, and two config files. The scaffold additionally shipped `claude-haiku-3-5-20241022` on **every `anvio init`** — a reversed-segment spelling of an already-retired id, matching no model in any generation. The chat route it configured had no fallback, so it was a hard 404 on first use.

## Decision

### D1 — State the invariant on the type, and enforce it in one function

`TokenUsage.inputTokens` is documented as the inclusive prompt total. Costing code must not consume it alongside the cache counts; it calls `costInputFromUsage()` (`packages/models/src/model-descriptor.ts`), which returns the disjoint buckets `estimateModelCostUsd` expects.

`CostEstimateInput.inputTokens` means _uncached input only_ — a different quantity from `TokenUsage.inputTokens` despite the shared name. That is the trap this ADR exists to close, so both types now say which one they are.

`addTokenUsage` sums the cache fields rather than dropping them.

### D2 — One price registry, keyed on `provider:model`

`MODEL_COST_PER_1M` is deleted. `estimateTokenCostUsd` delegates to `estimateModelCostUsd` and now takes `provider` as its first argument — a signature change, but the only caller in the request path (`TokenUsageAudit.record`) already had `provider` on the record it was writing.

### D3 — Cache the conversation

Both `messages.create` and `messages.stream` set top-level `cache_control: { type: 'ephemeral' }`, letting the API auto-place a breakpoint on the last cacheable block. Combined with the existing system and tool breakpoints that is three of the four allowed. Gated on the same `promptCaching` flag as the other two.

### D4 — Model ids live in `packages/core`, not `packages/models`

`MODEL_IDS`, `DEFAULT_MODELS`, `KNOWN_MODEL_IDS`, and `RETIRED_ANTHROPIC_MODEL_IDS` are in core.

Core is the less obvious home — it holds schemas and ports, and a model id is data. But the dependency rule is `apps → platform → packages → core` with **core having no internal dependencies**, and one of the eight duplicate literals is `packages/core/src/markdown/agent-md.ts`. Putting the constants in `packages/models` would have left that site unable to import them, so the "single source" would have shipped with a second source still in it.

Two specs guard it: descriptors and provider defaults resolve to shared constants (`packages/models/src/model-ids.spec.ts`), and the scaffolded `routing.yaml` names only known, non-retired ids and gives every route a fallback (`packages/workspace/src/scaffold-model-ids.spec.ts`). `defaultRoutingYaml` was exported to make the second possible.

**Amended (issue #26):** a third guard, `packages/workspace/src/config-model-ids.spec.ts`, covers ids the repo _ships_ as config rather than generates — see the amendment below.

### D5 — The default model is _not_ rotated here

`DEFAULT_MODELS.anthropic` remains `claude-sonnet-4-20250514`. It is a deprecated dated snapshot, and moving it is now a one-line change — but it is a live behaviour and cost change for every existing workspace, and this ADR is about removing duplication, not choosing models. That decision is left explicit rather than smuggled in behind a refactor.

**Amended (issue #25):** rotated to `claude-sonnet-5` once the decision was taken on its own terms — see the second amendment below.

The scaffold's malformed haiku id **was** changed, to `claude-haiku-4-5`. That one was broken under every reading, so leaving it was not an option.

## Consequences

**Positive**

- Cached tokens are billed once, at the cache rate. On a long tool-using session the double-count was the larger error of the two.
- `anvio usage stats` shows a cost for every model in the registry rather than three.
- The conversation cache breakpoint is the single largest cost lever in the codebase and cost one line at each of two call sites.
- A new `anvio init` no longer ships a chat route that 404s.

**Negative**

- `estimateTokenCostUsd`'s signature changed. It is exported from `packages/platform`, so any out-of-tree caller breaks — deliberately, because the old signature could not look up a descriptor and silently returned `undefined`.
- `costInputFromUsage` clamps at zero, so a provider reporting cache counts exceeding its own input total under-charges rather than producing a negative. Pinned by a test; revisit if a provider actually does this.
- ~~Config files (`configs/agents/architect.yaml`, `workspace/agents/architect.md`) still carry literal ids — YAML cannot import a constant. They are covered by neither guard spec.~~ **Closed — see the amendment below (issue #26).**
- ~~The default Anthropic model is still a deprecated snapshot (D5).~~ **Closed — see the second amendment below (issue #25).**

## Amendment — shipped config is guarded too (issue #26)

The two original guards cover ids the repo _generates_. Config files carry ids the repo _ships_, and YAML and Markdown cannot import a constant, so nothing checked them — which is exactly where the bug this guard family exists for would hide. `claude-haiku-3-5-20241022` reversed the family and version segments of an already-retired id, matched no model in any generation, and shipped on every `anvio init` because no spec read the file it lived in.

`config-model-ids.spec.ts` extracts every `model: <scalar>` from tracked files under `configs/` and `workspace/` and checks each against `KNOWN_MODEL_IDS` and `RETIRED_ANTHROPIC_MODEL_IDS`.

Three decisions inside it are load-bearing:

- **`git ls-files` is the scope, not a hand-maintained exclude list.** `workspace/` also holds runtime data — sessions, credential stores, soul caches — which is gitignored, machine-local, and free to name whatever model the operator actually ran. Scanning it would fail the spec on a developer's machine for a reason that is not a defect. What the repo commits is what the repo must stand behind, and git already knows exactly what that is.
- **`docs/` and `README.md` are out of scope.** They carry illustrative ids for providers this repo does not enumerate (`qwen/qwen-2.5-72b-instruct`, `o3`). Correct as prose, false positives as assertions.
- **The spec asserts it found something.** A guard that greps for its own inputs passes vacuously the day a directory is renamed or the key changes. Two explicit assertions — files matched, and `model:` values found — fail loudly instead.

Extensions are filtered in JS rather than passed as a git pathspec, because pathspecs are a union: `ls-files configs -- '*.md'` returns every tracked `.md` in the repo _plus_ everything under `configs/`. That mistake, made while writing this spec, produced a false failure on a docs example before it was caught.

## Cross-references

- ADR-0013: `packages/models` is the Model Gateway — this closes its cost-metering and `ModelDescriptor` gaps.
- ADR-0010: token optimization — prompt caching is Layer 2; D3 completes it for the conversation.
- ADR-0015: provider capability catalog — the `maxOutputTokens` ceiling added there and the pricing here are the two per-model facts the catalog and registry now hold between them.

## Amendment — the default model, decided on its own terms (issue #25)

D5 deferred this deliberately, and deferring was right: a default model is a spend decision, and spend decisions do not belong inside a deduplication refactor. Taken separately, the choice turned out to be narrower than it looked.

**`claude-sonnet-4-20250514` → `claude-sonnet-5`.**

The concern D5 raised was that rotating is "a live behaviour and cost change for every existing workspace." Half of that survives contact with the price list and half does not:

- **Cost: neutral.** Both sit at $3 / $15 per 1M tokens at list price. Anthropic is running $2 / $10 introductory rates on Sonnet 5 through 2026-08-31, so the rotation is briefly _cheaper_ and then identical. The descriptor records list price rather than the promotion — a cost table that goes quietly low the moment a promotion lapses is worse than one that is plainly list.
- **Behaviour: real, and in the intended direction.** A newer model answers differently. It also carries a 1M context window against 200K, and 128K max output against 8,192 — the descriptor is updated so routing and cost estimation see both.

**Staying in-tier was the point.** Moving the default to an Opus-class model would have been the change D5 actually warned about: 5x the input rate, chosen on the operator's behalf, for workspaces that never asked. A default's job is to be defensible when nobody is looking at it, not to be the best model available.

**A dated snapshot is a default with an expiry date on it.** It works until the vendor retires that build, and then every workspace that never named a model fails at once — and they are precisely the workspaces whose owners were not thinking about models. A new test asserts `DEFAULT_MODELS.anthropic` does not end in `-YYYYMMDD`, so the default cannot silently drift back onto a snapshot.

`MODEL_IDS.anthropicSonnet4` stays. Shipped config still names it, it still resolves, and removing it would break the guard added by the first amendment for no gain. It is a known id that is no longer the default — which is exactly what it should be.
