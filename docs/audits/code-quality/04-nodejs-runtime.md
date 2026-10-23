# 04 — Node.js Runtime Best Practices

Runtime assumptions: `engines.node >=20`, ESM (`"type": "module"`, `NodeNext`), target ES2022, CI on Node 20 (EOL 2026-04-30; CQ-029). Local verification ran on Node 24.21.0. Code uses `AbortSignal.timeout` (Node ≥17.3), global `fetch`/`WebSocket` (WebSocket global is stable only from Node 22 — `discord.ts:165`, `slack.ts:190` rely on it; on Node 20 it requires `--experimental-websocket`). **NOT VERIFIED** whether Node 20 CI exercises those code paths (no test opens a socket), so the Node 20 incompatibility is a MEDIUM-confidence risk folded into CQ-029.

## 1. Async / await and promise handling

| Pattern | Evidence | Assessment |
|---|---|---|
| Process-level guard | `platform/src/process-guards.ts:13-28` logs unhandled rejections and keeps running; exits on uncaught exceptions | Pragmatic and documented. It also masks floating promises, so they must be found by review. |
| Floating promises | 21 `void fn()` sites, e.g. `orchestrator.ts:254` (`void publishEvent`), `discord.ts:171`/`slack.ts:195` (`void this.start()`), `platform/index.ts:476` (`void eventBus.publishCore`), CLI `void shutdown()` (`main.ts:316`) | The channel `void this.start()` is a real bug (reconnect chain dies, CQ-008); CLI one loses shutdown (CQ-015). |
| Fire-and-forget with guard | `BaseChannelAdapter.runGuarded` (`base-channel-adapter.ts:77-90`) | Good — catches and logs. But it also means inbound messages are processed concurrently without per-session ordering (CQ-007). |
| `Promise.all` | `runtime.ts:432` (persona + skills — fine), `filesystem-memory.ts:97`, `orchestrator.ts:231` (unbounded fan-out, CQ-010) | No `Promise.allSettled` where partial failure is expected (shutdown stages, orchestrator waves rely on inner try/catch). |
| Sequential awaits in loops | `storeConversation` long-term loop (`filesystem-memory.ts:110-117`), tool calls executed sequentially (`tool-loop.ts:36`, `native-tool-loop.ts:14`) | Sequential tools are a deliberate safety choice; acceptable. |
| Async error propagation | `DefaultAgentRuntime.run` converts error chunks to `new Error(chunk.error)` (`runtime.ts:108`) | Loses error class/retryability; orchestrator then retries everything (CQ-010). |

## 2. Cancellation, timeouts, retries

- **Cancellation:** none end-to-end (CQ-006). Providers accept `signal`; runtime never creates one. Tool calls have no signal. Orchestrated sub-runs cannot be cancelled.
- **Timeouts:**
  - Present: `httpRequest` 15 s (`network-tools.ts:16`), `webFetch` 15 s, process sandbox `timeoutMs` default 30 s (`code-executor.ts:42`), remote shell `SHELL_TIMEOUT_MS` (`remote-dispatch.ts:74`), harness approval timeout.
  - Missing: model requests on `openai-compatible` (`provider.ts:327-340` — signal only), MCP stdio requests (not inspected in depth — **partially verified**), ssh/singularity `spawnSync` (CQ-027), whole-turn deadline.
- **Retries:** `fetchWithRetry` for channels honours `Retry-After` and 429/5xx (`channels/src/fetch-retry.ts:15-56`) — good. Orchestrator retries with exponential backoff capped at 8 s but without jitter or error classification (CQ-010). Channel reconnect: fixed 5 s, no backoff/jitter (CQ-008).

## 3. Event loop and performance

| Risk | Evidence | Severity |
|---|---|---|
| Synchronous child processes | `spawnSync` in ssh/singularity/remote-stub runtimes and `niche-tools.ts:102` | CQ-027 (LOW for CLI-only callers; would be HIGH if reached from gateway). `niche-tools.ts:102` call site not traced — **NOT VERIFIED** whether reachable from the daemon. |
| Sync crypto KDF | `scryptSync` per encrypt/decrypt (`encrypted-store.ts:16,29`) | CQ-031 |
| Sync fs on boot | `find-workspace.ts:13,24`, `db/seed.ts` | Acceptable (startup / CLI). |
| Full buffering of untrusted payloads | `res.text()` before slice (`network-tools.ts:23`, `web-fetch.ts:12`); sandbox stdout `+=` unbounded (`process-sandbox.ts:46`); docker sandbox likewise (`:147`) | CQ-002 / CQ-003 — memory exhaustion from a single large response or chatty process. |
| Regex HTML stripping on large bodies | `web-fetch.ts:13` runs two global regexes over the full (unbounded) body | Low; bounded once the body is capped. |
| Repeated config work per iteration | `listTools()`/`getModelToolDefinitions()` rebuilt multiple times per iteration (`runtime.ts:176-181,302`); `resolveMaxToolOutputChars()` reads `process.env` per tool call | Low. |
| Unbounded concurrency | orchestrator fan-out (CQ-010); concurrent turns per Slack/Discord thread (CQ-007) | HIGH (covered). |

## 4. Timers, listeners, memory leaks

- Typing keep-alive timers are `unref`'d and cleared on stop (`base-channel-adapter.ts:164-189`) — good.
- `streamBuffer` map in `BaseChannelAdapter` is released on `done`/`error`; an approval pause or worker crash mid-stream leaves the entry until next `done` for that session — slow leak bounded by session count (LOW, not filed).
- `DefaultAgentRuntime.stopRequests` grows with stop requests for sessions that never run again (part of CQ-006).
- Reconnect `setTimeout`s are never tracked or cleared on stop (CQ-008).
- `PendingMutationStore` expires items by TTL (`pending-mutations.ts`), fine.
- `LocalEventBus` subscriptions return unsubscribe functions; `close()` clears handlers (`local-event-bus.ts:76`) — good.

## 5. Resource lifecycle and graceful shutdown

| Resource | Lifecycle | Gap |
|---|---|---|
| HTTP server (unified gateway) | `server.close` in `shutdown` (`unified-gateway.ts:182-184`) | Called last, after bus closed; no connection drain timeout (CQ-015) |
| WebSockets (Slack/Discord) | `stop()` closes | Reconnects after stop (CQ-008) |
| Telegram long-poll | `polling=false` | In-flight `getUpdates` (25 s) not aborted — shutdown waits or process exits mid-request |
| Child processes (sandbox, MCP stdio) | SIGKILL on timeout | Direct child only; MCP stdio teardown on shutdown not verified (**NOT VERIFIED**) |
| Event bus / NATS | `eventBus.close()` | Closed before engines that publish to it |
| OTel SDK | `shutdownObservability()` | Present in all entry points |
| Process signals | gateway/api: SIGINT+SIGTERM; worker: SIGINT only; CLI: exits before async cleanup | CQ-015 |

## 6. Type safety

- `strict` TS everywhere; `any` ×7, `as unknown as` ×8 in source — strong.
- Runtime validation at external boundaries is good for **config** (zod schemas in `core/src/schemas`, `parseToolGatewayConfig`) and weak for **persisted runtime state** (checkpoint cast, CQ-023) and **model tool arguments**: builtins coerce with `String(call.arguments.x ?? '')` (`builtins/index.ts:165,200,344-348,365,386-390`) rather than validating against the same JSON schema advertised to the model (`tool-schemas.ts`). A missing `path` becomes `''` and resolves to the workspace root instead of a validation error.
- Error modelling: `AnvioError` with codes exists and is used in places (`model-router.ts:376`, `ssh-runtime.ts:63`), but most paths throw plain `Error` or return `{ status:'failed', error: string }`, so callers cannot branch on error kind (feeds CQ-010).
- Discriminated unions are used well for stream chunks (`type: 'chunk' | 'progress' | 'approval_required' | 'error' | 'done'`) and exhaustiveness checks (`orchestrator.ts:201-204`, `mcp-tool-port.ts:23-36`).

## 7. Node.js-specific risks — ranked

1. No cancellation/timeout on model and tool I/O (CQ-006).
2. Serial in-process event dispatch makes the daemon single-lane per adapter (CQ-007).
3. Untrusted payloads fully buffered in memory (CQ-002/003).
4. Shutdown and reconnect lifecycles leak or lose work (CQ-008, CQ-015).
5. Global `WebSocket` reliance vs Node 20 engine floor (CQ-029, MEDIUM confidence).
6. Sync KDF / sync child processes on potentially shared loops (CQ-031, CQ-027).
