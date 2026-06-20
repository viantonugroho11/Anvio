# Phase P11a — Tool breadth, OTel wiring, planner CLI

**Status:** shipped (v1.17.0)  
**Depends on:** P10 (metrics + token audit)

## Goals

1. **P11a-T1** — expand built-in tool catalog from 12 → 21 tools
2. **P11a-O3** — wire `initObservability()` in worker + API with agent run spans
3. **P11a-W5** — `anvio planner run` CLI for PLAN → EXECUTE → REVIEW

## P11a-T1 — New tools

| Tool | Default | Description |
|------|---------|-------------|
| `list_dir` | on | List workspace directory entries |
| `edit_file` | off | Search/replace edit in file |
| `run_shell` | off | Shell command via sandbox executor |
| `http_request` | on | Generic HTTP with method/headers/body |
| `path_exists` | on | Check file/dir existence |
| `file_delete` | off | Delete workspace file |
| `append_file` | off | Append to workspace file |
| `json_parse` | on | Parse JSON text |
| `datetime_now` | on | Current ISO datetime + unix ms |

Enable write/exec tools in `workspace/tools/gateway.yaml` when needed.

## P11a-O3 — Observability

Set env to enable OTLP traces (compatible with Langfuse OTLP ingest):

```bash
export ANVIO_OTEL_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64(public:secret)>"
```

Worker wraps each detached agent run in span `agent.run`. API initializes OTel on bootstrap.

## P11a-W5 — Planner CLI

```bash
anvio planner phases
anvio planner run "Add health check endpoint to API" [--json]
```

Uses `configs/planner/plan-execute-review.yaml` or `workspace/planner/plan-execute-review.yaml`.

## Remaining (P11b+)

- SSH remote agent execution (R3)
- Harness snapshot tests per adapter (C2)
- IMAP IDLE push (C6)
- Expand tools toward 30+ (T1 continued)
