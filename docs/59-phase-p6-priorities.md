# Phase P6 — OpenAI native tools, memory recall, strict harness

**Status:** shipped in v1.11.0  
**Depends on:** P4 (Anthropic native tools), P5 (harness approval)

## Goals

1. **P6a — OpenAI-compatible native `tool_use`** for all providers using chat/completions (OpenAI, Groq, DeepSeek, OpenRouter, …).
2. **P6b — `memory_recall` tool** wired to filesystem/SQLite FTS recall index.
3. **P6c — Strict harness output** on messaging channels: no raw assistant dump fallback; agent must call `anvio_channel__reply`.
4. **CI fix** — export `ChannelHealthReport`, type-safe health summary, Slack block-action `user` payload.

## P6a — OpenAI native tools

When `ModelProvider.supportsNativeTools` is true (OpenAI-compatible providers default to `true`), the agent runtime uses the native tool loop instead of fenced `anvio_tool` blocks.

Implementation:

- `packages/models/src/providers/openai-messages.ts` — message + tool mapping
- `packages/models/src/providers/openai-compatible.provider.ts` — `tools` in request, stream `tool_calls` deltas

## P6b — memory_recall

Built-in tool `anvio_tools__memory_recall`:

```json
{ "query": "deployment checklist", "limit": 5 }
```

Platform wires `memoryRecall` via `FilesystemMemoryProvider.search()` (FTS5 when enabled).

Enable in `tools/gateway.yaml`:

```yaml
spec:
  tools:
    memory_recall:
      enabled: true
```

## P6c — Strict harness output

Worker behavior when `suppressRawOutput` is active (Slack, Telegram, WhatsApp, …):

- Streaming text chunks are **not** sent to the channel.
- On completion, **no fallback** raw dump — only `anvio_channel__reply` delivers user-visible text.
- Warning logged if run finishes with content but no harness reply.

## CI fixes

- Export `ChannelHealthReport` / `ChannelHealthState` from `@anvio/core`
- Exhaustive switch in `summarizeChannelHealth`
- Slack Socket Mode block actions include `payload.user.id`

## Remaining (P7+)

- Gemini native tools
- MCP first-call approval gate
- Channel E2E for Teams/Matrix/Email
- LLM SoulData extraction
