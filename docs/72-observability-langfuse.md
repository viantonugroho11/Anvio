# Observability — Langfuse + OpenTelemetry

Anvio emits traces and metrics via OpenTelemetry (OTLP). Langfuse can ingest the same pipeline for LLM observability dashboards.

## OTLP export (built-in)

Set environment variables before starting the gateway or CLI:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=anvio
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
```

HTTP/protobuf endpoint (4318) is the default for local collectors and Langfuse OTLP ingress.

## Langfuse self-hosted

1. Run Langfuse (Docker or cloud)
2. In Langfuse project settings, copy OTLP endpoint + public/secret keys
3. Point Anvio:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n 'pk-lf-...:sk-lf-...' | base64)"
```

## What gets traced

| Span | Source |
|------|--------|
| Agent run | `DefaultAgentRuntime` |
| Tool calls | Tool gateway + MCP bridge |
| MCP server health | `anvio mcp health` |
| Channel harness | Inbound/outbound when enabled |

Token usage is also written to the workspace audit ledger (`anvio usage stats`).

## Dashboard checklist

- Trace latency p50/p95 per agent
- Tool error rate by `anvio_tools__*` vs `anvio_mcp__*`
- MCP first-call approval wait time
- Channel reply vs raw output suppression (harness)

## Local dev stack (optional)

```yaml
# docker-compose snippet
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib
    ports: ['4318:4318']
  langfuse:
    image: langfuse/langfuse:latest
    ports: ['3000:3000']
```

Forward collector → Langfuse using Langfuse docs for your version.

See [CHANGELOG](../CHANGELOG.md) P11a OTel notes and `packages/core` telemetry helpers.
