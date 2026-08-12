# Observability

Anvio ships three observability surfaces from `@anvio/observability` at Phase 1 (all shipped v1.26.0-1.27.0):

## Structured logger (pino)

`createLogger(name)` returns a `pino` child logger namespaced by module. Env-tunable:

- `ANVIO_LOG_LEVEL` — `trace|debug|info|warn|error|fatal`. Defaults: `info` when `NODE_ENV=production`, else `debug`.
- `ANVIO_SERVICE_NAME` — value emitted as `service` on every log record. Default `anvio`.

```ts
import { createLogger } from '@anvio/observability';
const log = createLogger('agents:runtime');
log.debug({ sessionId, agentId }, 'starting model call');
```

Test hook: `setRootLogger(logger | undefined)` swaps the root; pass `undefined` to reset.

### `no-empty` lint rule

Repo-root ESLint config enforces `no-empty` with `allowEmptyCatch: false`. All 46 existing catch blocks have content (verified v1.26.0); new empty catches fail CI lint.

## Metrics registry

`getMetricsRegistry()` returns an in-process `MetricsRegistry` with counters, gauges, and histograms. `toPrometheusText()` renders a `/metrics` payload.

### Per-model-call metrics (P1.S3, since v1.26.0)

Providers wrap `chat` + `stream` with `withCallMetrics(providerId, model, fn)` and `recordStreamMetrics(providerId, model, usage, startedAtMs)` — one call each in `anthropic.provider.ts`, `openai-compatible.provider.ts`, `gemini.provider.ts`. Emitted per call:

| Metric | Type | Labels |
|---|---|---|
| `anvio_tokens_input_total` | counter | provider, model, channel |
| `anvio_tokens_output_total` | counter | provider, model, channel |
| `anvio_tokens_total` | counter | provider, model, channel |
| `anvio_tokens_cache_read_total` | counter | provider, model, channel |
| `anvio_tokens_cache_creation_total` | counter | provider, model, channel |
| `anvio_token_cost_usd_total` | counter | provider, model, channel |
| `anvio_model_calls_total` | counter | provider, model, channel |
| `anvio_model_call_latency_ms` | histogram | provider, model, channel |
| `anvio_mcp_restarts_total` | counter | server |

Histogram snapshot: `registry.snapshotHistogram('anvio_model_call_latency_ms', labels)` → `{ count, sum, min, max }`.

Token cost estimated via `estimateModelCostUsd(provider, model, usage)` from the [ModelDescriptor registry](09-model-router.md#modeldescriptor-registry). Unknown models silently emit token counts without cost.

### Session-level audit

`TokenUsageAudit` (`packages/platform/src/token-usage-audit.ts`) subscribes to `AGENT_RUN_COMPLETED` events, appends `audit/tokens.jsonl` with `{ ts, sessionId, channel, agentId, userId, provider, model, usage, estimatedCostUsd, latencyMs }`, and forwards to `MetricsRegistry.recordTokenUsage` with cache-token and latency fields.

## OpenTelemetry traces

`initObservability({ serviceName, otlpEndpoint, enabled })`. Enable when `ANVIO_OTEL_ENABLED=true` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Auto-instrumentations from `@opentelemetry/auto-instrumentations-node` (0.75.x since v1.25.1).

`withSpan(name, attributes, fn)` — helper that starts an active span, sets attributes, records `OK` on resolve or `ERROR` on throw, then ends the span.

`shutdownObservability()` — call on process shutdown to flush the OTLP exporter.

## Deferred

- Prometheus `/metrics` scrape endpoint served by `apps/api` — currently only `MetricsRegistry.toPrometheusText()` is available; not wired to an HTTP route.
- Grafana dashboards for the shipped Anvio metrics — `configs/observability/langfuse-dashboard.json` exists for LLM traces only.
- Log-based cost aggregation dashboard.
- Distributed circuit-breaker state via substrate ([ADR-0013](adr/0013-model-gateway-evolution.md) — currently process-local).
