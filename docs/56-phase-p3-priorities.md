# Phase P3 — Tools, slaude import & scheduled learning (2026)

**Status:** Complete (v1.8.0)  
**Scope:** Close high-impact gaps from [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) after Phase L6.

---

## Priority stack

| ID | Deliverable | Status |
|----|-------------|--------|
| T3 | Image generation tool (DALL-E) | ✅ v1.8.0 |
| T4 | Text-to-speech tool (OpenAI TTS) | ✅ v1.8.0 |
| S6 | `slaude.json` manifest import | ✅ v1.8.0 |
| L5 | Scheduled session summarizer (cron) | ✅ v1.8.0 |
| T1 | Native Anthropic `tool_use` API | 🟡 deferred |
| V4 | Streaming STT | 🟡 deferred |
| R8 | Desktop app | ⏸ deferred |

---

## Image & TTS tools

Enable in `workspace/tools/gateway.yaml`:

```yaml
spec:
  tools:
    image_generate:
      enabled: true
    text_to_speech:
      enabled: true
```

Requires `OPENAI_API_KEY`. Outputs saved under `workspace/artifacts/images/` and `artifacts/audio/` when workspace root is available.

```bash
anvio tools test anvio_tools__image_generate "sunset over mountains"
anvio tools test anvio_tools__text_to_speech "Hello from Anvio"
```

---

## slaude.json import (S6)

```bash
anvio kb import-slaude ./slaude.json
```

Manifest format (see `configs/examples/slaude.json`):

```json
{
  "knowledge": [{ "slug": "playbook", "rawDir": "knowledge/raw" }],
  "skills": [{ "source": "skills/example.md", "slug": "example" }]
}
```

Copies raw notes → `knowledge/{slug}/raw/`, runs wiki ingest, copies skills → `workspace/skills/`.

---

## Scheduled session summarizer (L5)

Cron automation (disabled by default):

`workspace/automations/session-memory-summarize.yaml` — every 6 hours, action `learning.summarize_sessions`.

Manual run:

```bash
anvio learning summarize-sessions
anvio automation run session-memory-summarize
```

Requires worker/automation engine running for cron. Uses LLM summarizer when model API key is set.

---

## Remaining gaps (next)

See [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md) — remaining gaps at v1.15.0 (~87% Hermes, ~92% slaude): tool catalog breadth, desktop, streaming STT, RL export, slaude polish.

---

## Related

- [43-learning-loop.md](./43-learning-loop.md)
- [44-tool-gateway.md](./44-tool-gateway.md)
- [55-phase-l6-learning-priorities.md](./55-phase-l6-learning-priorities.md)
