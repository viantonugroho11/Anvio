# ADR-0010: Token Optimization Strategy

## Status

Accepted — all three layers shipped in v1.25.0.

## Context

Anvio's agent runtime sends the **full conversation history** to the model on every turn.
`FilesystemMemoryStore.storeConversation` calls `shortTerm.setMessages(sessionId, messages)` with the complete accumulated array — no limit, no pruning.
As a session grows, every API call pays for the entire history in input tokens.

Three compounding sources of waste:

1. **Unbounded short-term window** — a 50-turn session sends 50 messages of history on turn 51.
2. **No prompt caching** — system prompt and tool definitions are re-sent verbatim every turn.
   Anthropic charges full price for them every time despite being identical across turns.
3. **Large tool outputs** — skill traces, file contents, and tool results enter the message array
   at full size with no truncation.

Reference: [caveman-code](https://github.com/JuliusBrussee/caveman-code) takes the approach of
compressing file representations before they enter the context window (outline-only views,
whitespace stripping, chunking). Anvio needs equivalent savings at the **memory and provider layers**.

## Decision

Implement token optimization in three layers, in priority order:

---

### Layer 1 — Sliding window + auto-summarize on overflow (highest impact)

**Where:** `packages/memory/src/filesystem-memory.ts` + `MemoryStore` contract

**Mechanism:**

```
MAX_SHORT_TERM_MESSAGES = 40  (configurable via anvio.yaml: memory.maxShortTermMessages)

On storeConversation():
  if messages.length > MAX_SHORT_TERM_MESSAGES:
    tail = messages.slice(-MAX_SHORT_TERM_MESSAGES / 2)       // keep newest half
    head = messages.slice(0, messages.length - tail.length)   // oldest half to compress

    summary = SessionSummarizer.summarize(head)               // already exists in @anvio/learning
    summaryMessage: ChatMessage = {
      role: 'assistant',
      content: `[Context summary — ${head.length} earlier messages compressed]\n${summary}`
    }

    store([summaryMessage, ...tail])   // replaces full history
```

**Result:** history stays bounded at `MAX_SHORT_TERM_MESSAGES / 2 + 1` messages after compression.
A 200-turn session never exceeds ~21 messages in the next API call.

**Config surface (`anvio.yaml`):**

```yaml
memory:
  maxShortTermMessages: 40   # 0 = unlimited (default today)
  summarizeOnOverflow: true  # false = truncate without summarizing
```

---

### Layer 2 — Anthropic prompt caching (second highest impact)

**Where:** `packages/models/src/providers/anthropic.provider.ts`

**Mechanism:** Anthropic's API supports `cache_control: { type: "ephemeral" }` on message content
blocks. Cached blocks are billed at 10% of normal input-token cost on cache hits (5-minute TTL).

Apply caching to:
- **System prompt** — identical across all turns of a session; tag the last text block with
  `cache_control`.
- **Tool definitions** — identical across all turns; tag the last tool definition.

```typescript
// In stream() / chat() call to Anthropic SDK:
system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]

tools: toolDefs.map((t, i) =>
  i === toolDefs.length - 1
    ? { ...t, cache_control: { type: 'ephemeral' } }
    : t
)
```

**Savings:** For a typical session with a 2 000-token system prompt and 20 turns,
caching saves ~38 000 input tokens (19 cache hits × 2 000 tokens × 90% discount).

**Condition:** Only applied when `model.provider === 'anthropic'` and the SDK version
supports `cache_control` (Anthropic SDK ≥ 0.26).

**Config surface:**

```yaml
model:
  promptCaching: true   # default true for anthropic provider; false to disable
```

---

### Layer 3 — Tool output truncation (lower impact, avoids tail bloat)

**Where:** `packages/agents/src/tool-loop.ts` + `native-tool-loop.ts`

**Mechanism:** After each tool call result is returned, clip the `output` field:

```typescript
const MAX_TOOL_OUTPUT_CHARS = 8_000   // ~2 000 tokens

function clipToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  const half = MAX_TOOL_OUTPUT_CHARS / 2;
  return `${output.slice(0, half)}\n\n[… ${output.length - MAX_TOOL_OUTPUT_CHARS} chars truncated …]\n\n${output.slice(-half)}`;
}
```

Head + tail preserved so the model sees both the start and end of large outputs (e.g. a file with
imports at top and logic at bottom).

**Config surface:**

```yaml
tools:
  maxOutputChars: 8000   # 0 = unlimited
```

---

## Consequences

### Positive

- **Layer 1** eliminates the dominant cost driver for long sessions; a 100-turn session costs
  roughly the same as a 21-turn one after the first compression cycle.
- **Layer 2** cuts per-turn cost by ~90% on the system-prompt portion with zero quality change;
  applies automatically when using Anthropic models.
- **Layer 3** prevents a single large tool result (e.g. a 50 KB file read) from inflating every
  subsequent turn's cost.
- All three layers are independently toggleable. Shipped defaults in v1.25.0:
  - `memory.maxShortTermMessages: 0` (unlimited — Layer 1 opt-in, backward-compatible).
  - `promptCaching: true` (Layer 2 on by default; opt-out via `ANVIO_PROMPT_CACHING=false`).
  - `ANVIO_MAX_TOOL_OUTPUT_CHARS=8000` (Layer 3 on by default; `0` disables).

### Negative / Trade-offs

- **Layer 1 compression loses detail** — the summarized head is a lossy representation.
  Critical facts from early turns may be dropped. Mitigation: long-term memory (`@anvio/memory`)
  still stores all messages; the agent can be prompted to recall via `memory_search`.
- **Layer 2 cache TTL is 5 minutes** — if turns are >5 min apart, cache misses. No correctness
  impact, just no savings for slow sessions.
- **Layer 3 truncation may hide relevant content** — tools that return structured data (JSON)
  may be cut mid-structure. Mitigation: the head+tail clip is safer than a hard cut; structured
  tool consumers should use `outputs` (typed map) from `SkillExecuteResult` instead of raw text.

## Implementation Plan

| Step | Package | Effort |
|---|---|---|
| 1. Add `maxShortTermMessages` to `anvio.yaml` schema | `@anvio/core` | Small |
| 2. Sliding window in `FilesystemMemoryStore` | `@anvio/memory` | Medium |
| 3. Wire `SessionSummarizer` into memory overflow path | `@anvio/memory` + `@anvio/learning` | Medium |
| 4. `cache_control` in Anthropic provider | `@anvio/models` | Small |
| 5. Tool output clip in tool-loop | `@anvio/agents` | Small |
| 6. Expose metrics in `token-usage-audit.ts` (hit/miss, compressed turns) | `@anvio/platform` | Small |

Target release: v1.25.0
