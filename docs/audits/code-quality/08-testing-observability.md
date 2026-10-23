# 08 — Testing & Observability

## 1. Test inventory (executed: `pnpm test` → 148 files, 800 tests, all passing, 15.1 s)

- Unit specs colocated in packages; integration specs in `tests/integration/` (≈40 files named by delivery phase).
- Deterministic model testing infrastructure exists: `models/src/scripted-provider.ts` (+ spec) and `platform/src/simulation.ts`. This is the right foundation for agent-loop tests.
- Strongly tested areas: `models` (12 specs: router stream/pools/budget, breaker, provider errors, message mapping), `platform/webhook-auth` (386-line spec), `channels` (multiple per-adapter specs incl. Telegram, WhatsApp verify), `harness` approval gate (incl. rehydrate), `agents` runtime history/routing and stream-failure specs, `workspace` trash/mutations.

### Packages with zero unit specs (non-spec files in parentheses)

`apps/cli` (1 file, 2 883 lines), `apps/gateway`, `apps/worker`, `apps/web` (3), `auth` (1), `goals`, `personas`, `acp` (3), **`credentials` (3)**, **`storage` (3)**, `workflows` (3), `batch`, `blueprints`, `db`, **`execution` (4)**, `kanban`, `hooks` (5). Some have integration coverage (`credentials.integration.spec.ts`, `code-execution.integration.spec.ts`, `kanban`, `batch`, `acp`), but the security-critical primitives — JWT verification, path containment, sandbox env, encryption round-trip with wrong passphrase — have no focused tests. `auth` has neither.

## 2. Missing scenarios (each maps to a finding)

| Scenario | Current coverage | Finding |
|---|---|---|
| Iteration cap reached with tools still requested | none found (`maxToolIterations` appears only in `remote-dispatch.spec.ts`) | CQ-005 |
| Approval requested mid-batch, then resume | approval-gate specs cover gate, not runtime checkpoint content | CQ-004 |
| `stop()` during stalled stream / long tool / on idle session | none in `agents/src/*.spec.ts` | CQ-006 |
| Concurrent turns on one session | none | CQ-007 |
| Channel `stop()` then wait → no reconnect; `start()` failure retried | none (adapters construct `WebSocket` internally) | CQ-008 |
| Skill cycle A→B→A | none | CQ-009 |
| Orchestrator: sub-agent awaiting approval; non-retryable error; concurrency bound | none for these branches | CQ-010 |
| Malformed `tools/gateway.yaml` | `phase-h` integration loads gateway, not malformed | CQ-012 |
| Path `../<root>-sibling`, symlink escape | none | CQ-013 |
| Crash between write and rename | none | CQ-014 |
| SIGTERM to worker/gateway | none | CQ-015 |
| Provider idle timeout | none | CQ-006 |
| Half-open breaker allows one probe | breaker spec exists; does not assert single probe | CQ-022 |
| Token audit provider correctness | `token-usage-audit.spec.ts` tests the recorder, not the provider value passed | CQ-019 |

## 3. Test design observations

- **Isolation:** integration tests boot real platforms against temp workspaces; the executed run left the git tree clean (verified `git status`), suggesting good temp-dir hygiene.
- **Determinism:** scripted providers avoid network; CI sets `ANTHROPIC_API_KEY=test-key`. Tests passed in one run; flakiness not measured (single run).
- **Naming:** phase-coded integration files (`phase-p11a`, `phase-p13`) describe *when* behaviour shipped, not *what* is protected; failures are harder to triage. Prefer `approval-resume.integration.spec.ts` style names.
- **Testability blockers:** closures in `createPlatform`/`registerPlatformExtras` (CQ-011); internal `new WebSocket`/`setTimeout` in adapters; direct `fs` in `ToolGateway.load` and `skill-evolution`. Injecting a `WebSocketFactory`/clock would unlock lifecycle tests without new frameworks.
- **Coverage measurement:** no coverage reporter configured in `vitest.config.mts` → line/branch coverage **NOT MEASURED**.
- **Behaviour vs implementation:** sampled specs (`runtime-stream-failure.spec.ts`, `model-router-stream.spec.ts`) assert observable outputs (chunks, stored history) rather than internals — good.

## 4. Logging

- 384 `console.*` calls in non-spec source; prefix conventions vary (`[gateway]`, `[Telegram]`, `[Discord]`, `[${label}]`).
- A pino-based `createLogger` with module child loggers and an override hook exists (`observability/src/logger.ts`) but **no package uses it** (CQ-018).
- Levels are implicit (`console.log` for lifecycle, `console.error` for failures); no `warn`/`debug` separation, so a "debug when needed" story does not exist.

## 5. Metrics and tracing

- OpenTelemetry NodeSDK init/shutdown in every app entry point, gated by `ANVIO_OTEL_ENABLED`/`OTEL_EXPORTER_OTLP_ENDPOINT`.
- `withSpan` used exactly once (`gateway-worker.ts:157`, span `agent.run` with sessionId/agentId/channel attributes). No spans for model calls, failovers, tool calls, MCP calls, channel sends.
- `metrics-registry.ts` + `models/src/metrics-emitter.ts` exist; 4 call sites of `getMetricsRegistry()` outside observability. Router/breaker metrics are partially emitted; tool and channel metrics absent.
- Langfuse integration documented (`docs/72-observability-langfuse.md`) — implementation not re-audited.

## 6. Correlation and identifiers

| Identifier | Exists? | Propagated to logs/spans? |
|---|---|---|
| Session id | yes | ad hoc in some log lines; span attribute on `agent.run` |
| Run / turn id | **no** | — |
| Tool call id | native tool calls only (`call.id`); parsed calls none | no |
| Approval request id | yes | in messages, not logs |
| Provider request id | not captured | no |
| Event envelope id | yes (`events/src/envelope.ts`) | not logged |

## 7. Can a production failure be diagnosed without reconstructing the flow?

**No, not reliably.** Example: a Slack user reports "the bot answered but forgot it". Root causes could be CQ-007 (concurrent overwrite), CQ-021, the `storeConversation` failure path (06 §6), or CQ-014. Logs contain neither a run id nor the persistence error (swallowed), and no span covers the memory write. An engineer must reproduce with a debugger.

## 8. Recommendations

1. Add a `runId` (uuid) at turn start in the gateway worker; pass via `UserInput.metadata`; bind into a child logger and the `agent.run` span. (S)
2. Adopt `createLogger` in runtime, gateway-worker, tool gateway, channels first (M); add a lint rule `no-console` scoped to `packages/*/src` once migrated.
3. Spans: `model.stream` (provider, model, failover), `tool.call` (name, status, duration), `channel.send`. (M)
4. Tests: one spec per row in §2, using `scripted-provider`; add `@vitest/coverage-v8` (requires approval to install) and publish coverage in CI. (M)
5. Rename phase-coded integration specs as they are touched.
