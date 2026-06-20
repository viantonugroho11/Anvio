# Phase L6 — Runtime Learning & LLM Skill Evolution (2026)

**Status:** Complete (v1.7.0)  
**Scope:** Hermes-style runtime self-improve, agent tool loop, LLM summarizer for skills & session memory.

---

## Priority stack

| ID | Deliverable | Status |
|----|-------------|--------|
| L6 | Skill self-improve during tool use | ✅ v1.7.0 |
| L6b | Agent runtime tool loop (multi-turn) | ✅ v1.7.0 |
| L5b | LLM session + skill summarizer | ✅ v1.7.0 |
| L5 | Scheduled periodic summarizer (cron) | 🟡 deferred P3 |
| L6c | Native Anthropic `tool_use` API | 🟡 deferred P3 |

---

## Runtime self-improve (Hermes-style)

On every **successful** built-in tool call:

1. `ToolGateway` fires `onToolCompleted` hook
2. `LearningEngine.onToolUseCompleted()` runs LLM analysis (or heuristic fallback)
3. Skill draft written to `workspace/skills/_drafts/`
4. Auto-promote to `workspace/skills/*.md` when `requireApproval: false`

Gated by soul evolution:

```yaml
spec:
  evolution:
    allowAutoUpdate: true
    requireApproval: false   # true = draft only, manual promote
```

---

## Agent tool loop

`DefaultAgentRuntime` runs up to **5** tool iterations when `ToolGateway` has enabled tools.

Model emits fenced blocks:

````markdown
```anvio_tool
{"name": "anvio_tools__web_fetch", "arguments": {"url": "https://example.com"}}
```
````

Tool results are fed back to the model until no tool calls remain.

---

## LLM summarizer

When a model API key is configured (Anthropic preferred):

| Trigger | Output |
|---------|--------|
| Session end (`AGENT_RUN_COMPLETED`) | LLM session summary → memory; skill draft if `shouldCreate` |
| Tool use success | LLM tool-pattern skill; auto-promote if allowed |

Without API key: rule-based fallback (Phase H behavior).

Platform wires learning model from `modelProviders` (skips `mock`).

---

## Learning on all CLI paths

`anvio chat` and inline `anvio run` emit `AGENT_RUN_COMPLETED` via `finalizeAgentRun()`.

Worker/detached runs unchanged (already emitted).

---

## CLI

```bash
anvio learning drafts
anvio learning promote <draft-slug>
anvio tools list
anvio tools test anvio_tools__web_fetch https://example.com
```

---

## Related

- [43-learning-loop.md](./43-learning-loop.md)
- [44-tool-gateway.md](./44-tool-gateway.md)
- [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md)
- [54-phase-p2-priorities.md](./54-phase-p2-priorities.md)
