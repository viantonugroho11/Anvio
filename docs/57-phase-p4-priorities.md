# Phase P4 — Native tool_use & expanded gateway (2026)

**Status:** ✅ v1.9.0  
**Scope:** Close T1/T5 gaps from [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) after Phase P3.

---

## Deliverables

| ID | Item | Status |
| --- | --- | --- |
| T1 | Expand built-in tool gateway (`glob_files`, `grep_search`, …) | ✅ v1.9.0 |
| T1 | Native Anthropic `tool_use` API in agent runtime | ✅ v1.9.0 |
| T5 | `execute_code_pipeline` multi-step sandbox | ✅ v1.9.0 |
| S6 | Workspace manifest import (`anvio kb import-manifest`) | ✅ renamed from legacy alias |

---

## Native tool loop

When the model provider sets `supportsNativeTools` (Anthropic), the runtime:

1. Passes `tools` from `ToolGateway.getModelToolDefinitions()` to the provider.
2. Handles `tool_use` stream chunks instead of fenced `anvio_tool` blocks.
3. Appends `role: tool` messages with `toolCallId` for the next model turn.

Providers without native tools keep the fenced-block fallback (OpenAI-compatible, Gemini, mock).

---

## New gateway tools

| Tool | Purpose |
| --- | --- |
| `glob_files` | List files matching glob under workspace |
| `grep_search` | Regex search in workspace source/docs |
| `execute_code_pipeline` | Run ordered code steps; stops on first non-zero exit |

Configure in `tools/gateway.yaml` — see `configs/examples/workspace-manifest.json` for KB/skills import.

---

## CLI

```bash
anvio kb import-manifest ./workspace-manifest.json
```

Legacy alias `import-slaude` still works for existing scripts.

---

## Next (P5+)

- OpenAI / Gemini native function calling
- Additional Hermes-parity tools (memory_recall, calendar, …)
- Desktop app (R8)

See [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md).
