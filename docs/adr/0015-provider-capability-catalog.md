# ADR-0015: The provider catalog describes capability, not just transport

## Status

Accepted — shipped in `packages/models/src/provider-catalog.ts` and `providers/gemini-messages.ts`. Continues the gap-closing programme in ADR-0013 D1.

## Context

One 267-line adapter — `OpenAICompatibleProvider` — serves fifteen vendors. That is a reasonable bet: OpenAI's Chat Completions shape is the de-facto lingua franca, and groq, together, fireworks, deepseek and friends do mimic it faithfully.

The bet failed at the edges because `OpenAICompatibleProviderSpec` had six fields, and every one of them described **transport**: `baseUrl`, `defaultModel`, `apiKeyEnv`, `extraHeaders`, `optionalApiKey`, `id`. Nothing described **capability**. So the adapter assumed all fifteen vendors share one completions path, one attitude to function calling, and one output-token ceiling. Concretely, and verified in the codebase:

| Vendor     | What broke                                                                                                                                                | Why the spec could not say otherwise                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| perplexity | Every tool-carrying turn sent a `tools` array its sonar models reject                                                                                     | `supportsNativeTools` existed on the _adapter_ (`openai-compatible.provider.ts`) but no spec field and no caller ever set it, so all fifteen got `true` |
| cohere     | Could never work: the spec pointed at `https://api.cohere.com/v2` while the adapter hardcoded `/chat/completions`, producing a path Cohere does not serve | No `path` field, and the base URL named Cohere's own API rather than an OpenAI-shaped one                                                               |
| moonshot   | `moonshot-v1-8k` budgets 8k across prompt _and_ completion, while the repo sends `max_tokens: 8192`                                                       | No output ceiling, and a ceiling expressed as a default would not have bound — see D2                                                                   |
| ollama     | `OLLAMA_API_KEY` was never read, so an authenticated or remote Ollama could not be given a key                                                            | `optionalApiKey: true` short-circuited the env lookup entirely, conflating "no key required" with "no key possible"                                     |

A separate, larger defect sat on the Gemini side. `gemini.provider.ts` passed each tool's `inputSchema` to `functionDeclarations[].parameters` **verbatim**. Gemini accepts an OpenAPI subset, not JSON Schema. Two shapes this repo actually ships are rejected:

- Six optional properties declared as bare `{ type: 'object' }` (`packages/tools/src/tool-schemas.ts` lines 125, 307, 344, 405, 416, 424). Gemini rejects an OBJECT with no `properties`.
- Two tools whose entire parameter schema is `{ type: 'object', properties: {} }` — `browser_get_images`, `ha_list_services`.

And the input is not limited to schemas this repo authors: `packages/integrations/src/mcp-tool-port.ts` forwards `inputSchema` straight from MCP servers as an arbitrary `Record<string, unknown>` (its own spec exercises `inputSchema: {}`). One malformed tool fails the entire request, not just that tool.

Finally, `gemini.provider.ts` defaulted a missing `finishReason` to `'STOP'` and ignored `promptFeedback`, so a prompt refused by Gemini's safety filters returned HTTP 200 with empty content and a stop reason claiming a clean finish.

## Decision

### D1 — Three capability fields, and deliberately not a fourth

`OpenAICompatibleProviderSpec` gains `supportsNativeTools`, `path`, and `maxOutputTokens`. Each closes a breakage named above.

A fourth field, `maxTokensParam` (for hosts wanting `max_completion_tokens`), was scoped out. **No default model in the catalog needs it.** Adding an unused knob is speculative generality, and the cost is not zero: it is a branch in the request builder that no test exercises and no vendor exercises. Add it with the first vendor that demonstrably requires it.

### D2 — Ceilings clamp; they do not default

`maxOutputTokens` is applied as `Math.min(requested, ceiling)` inside the adapter, not as a fallback when the caller omits a value.

This distinction is the whole point. `packages/core/src/schemas/agent.schema.ts` defaults `maxTokens` to 8192 and `agent-md.ts` populates it for every agent, so a request arriving at the adapter essentially always carries an explicit value. A ceiling implemented as a default would be dead code.

### D3 — `optionalApiKey` governs whether a key is _required_, not whether one is _looked up_

`createOpenAICompatibleFromSpec` now always consults the env var and uses `optionalApiKey` only to decide whether absence is an error.

### D4 — The Gemini schema sanitiser is an allowlist

`toGeminiSchema()` keeps only keys Gemini's `Schema` accepts and drops everything else, recursing through `properties`, `items`, and `anyOf`. An allowlist rather than a denylist **because the input is untrusted**: MCP servers can send any JSON Schema dialect, so unknown keywords must fail closed rather than reach the wire.

Two shapes need more than filtering:

- A property that sanitises to an object with no properties — a freeform object — has no Gemini equivalent. It is **dropped**, and any `required` entry naming it is dropped with it. All six such properties in this repo are optional, so nothing required is lost.
- A _top-level_ schema that sanitises away returns `undefined`, and the caller omits `parameters` entirely. That is precisely how Gemini expresses a no-argument function.

### D5 — Cohere points at the OpenAI compatibility endpoint, unverified

`cohere.baseUrl` becomes `https://api.cohere.ai/compatibility/v1`. The previous value could not work through this adapter under any circumstances, so this is strictly an improvement — but **it has not been exercised against a live Cohere key**, and this ADR should not be read as claiming it works. It is a hypothesis with a better prior than the code it replaces. Dropping cohere from the catalog was the alternative; it is still the right move if the compatibility endpoint turns out not to match.

**Amended (issues #24, #27):** the endpoint is now confirmed against Cohere's published documentation, and a second entry turned out to be pointing at the wrong host entirely — see the amendment below.

### D6 — Gemini stops claiming clean finishes

`promptFeedback.blockReason` now raises a non-retryable provider refusal (`providerRefusalError`, added to the ADR-0014 error module) in both `chat()` and `stream()`. A missing `finishReason` reports `'UNKNOWN'` rather than `'STOP'`.

## Consequences

**Positive**

- The catalog is now the single place a vendor's quirks are stated, and the adapter reads them. Onboarding vendor sixteen means adding a row, not editing the adapter.
- Gemini tool calling moves from "unproven" to "structurally valid for every schema this repo can produce", including arbitrary MCP input.
- A Gemini safety block is now a visible failure instead of an empty successful answer.

**Negative**

- `toGeminiSchema` silently narrows what the model can see: a tool with a freeform-object parameter is offered to Gemini without it, and the model cannot pass that argument at all. This is strictly better than the request failing, but it is a capability difference between providers that nothing currently surfaces to the user.
- The allowlist will drop keywords Gemini _does_ support if the list falls behind the API. Failing closed was the deliberate trade; the failure mode is a lost constraint, not a rejected request.
- ~~`cohere` remains unverified (D5).~~ **Partly closed — endpoint and model id are now documentation-verified; response parsing still has no live-key receipt. See the amendment below (issue #24).**

## Cross-references

- ADR-0013: `packages/models` is the Model Gateway — this closes further D1 gaps.
- ADR-0014: provider error classification — `providerRefusalError` is added there and consumed here.
- ADR-0006: MCP architecture — the source of the arbitrary tool schemas that motivate D4's allowlist.

## Amendment — two entries that had never been called (issues #24, #27)

Both issues asked for the same thing: exercise the entry against a live key. Neither key is available here, so this amendment does the next thing that is actually verifiable — check each entry against the vendor's own current documentation — and is explicit about which claim rests on which evidence.

### cohere — the URL was right, the model was a generation behind

Cohere's documentation configures an OpenAI client with `base_url="https://api.cohere.ai/compatibility/v1"`, and that client appends `/chat/completions` — exactly the path this adapter builds. D5's hypothesis is confirmed at the level of the endpoint.

What the same page showed was that `command-r-plus-08-2024` is stale: the Command family is now led by Command A+, and the docs' examples name `command-a-plus-05-2026`. **A default model nobody can call is the same failure as a wrong base URL** — the request is well-formed and still fails on first use — so it was worth fixing under the same issue.

Precisely what remains unverified: whether the compatibility endpoint's _response_ parses cleanly through `OpenAICompatibleProvider`. The request side matches the vendor's published example; the response side has no receipt. That is a narrower gap than D5 recorded, and it is not closed.

### huggingface — the entry named the wrong host

`https://api-inference.huggingface.co/v1` is the **legacy serverless Inference API**. Hugging Face's OpenAI-compatible surface is the Inference Providers router at `https://router.huggingface.co/v1` — a different host. The old entry could not have worked; it was a 404 waiting for its first user, which is exactly the "advertises support that fails at first use" failure issue #24 named.

**The cold-start problem in issue #27 dissolves rather than being solved.** The 503-with-`estimated_time` contract belongs to the legacy serverless API, where an idle model had to be woken on demand. The router dispatches to third-party inference providers that keep models warm — there is no wake-up to wait through, and so nothing for the fallback chain to prematurely give up on. No bounded-wait logic was added, because on the correct host there is nothing to wait for.

The default model moved with the host, for the same reason as cohere: the router serves what its providers host, not what was once serverless.

### The guard that would have caught both

Both failures had one shape — a base URL composing to a path the vendor does not serve — and nothing checked the composed URL. A new test walks every catalogued provider and asserts the composed request URL parses as an absolute http(s) URL, carries no doubled slash, and that every entry has a non-empty default model. It names the offending provider on failure.

That does not prove any endpoint is correct. It proves none of them is _malformed_, which is the part that can be known without a key — and it is the check whose absence let a wrong host sit in the catalog unnoticed.
