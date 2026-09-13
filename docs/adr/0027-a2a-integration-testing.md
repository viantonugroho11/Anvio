# ADR-0027: A2A End-to-End Integration Testing

**Status:** Accepted  
**Date:** 2026-09-12  
**Deciders:** Platform team, QA  
**Supersedes:** —  
**Related:** ADR-0026 (A2A Protocol Integration)

## Context

ADR-0026 delivered `packages/a2a` with unit tests covering mapping, agent card building, and basic server start/stop. These tests validate individual components but never exercise the **full SDK transport pipeline** — a real JSON-RPC `sendMessage` flowing through `DefaultRequestHandler`, hitting `AnvioAgentExecutor`, producing task lifecycle events, and returning a completed `Task` over the wire.

The official `@a2a-js/sdk` handles significant complexity internally: request parsing, task store coordination, event bus management, SSE framing, and push notification dispatch. Bugs at these integration boundaries won't surface in unit tests that mock or skip the SDK internals.

### Forces

1. SDK transport handlers (`jsonRpcHandler`, `restHandler`) parse/serialize differently — both need exercising.
2. Streaming (`sendMessageStream`) has SSE framing, chunked transfer, and event ordering concerns not testable without a live server.
3. Push notifications require a running webhook receiver to verify delivery.
4. Task lifecycle (submit → working → completed/failed/canceled) must be verified end-to-end, including concurrent cancel-while-executing.
5. Integration tests belong in `tests/integration/` per project convention and require `pnpm build` before running.

## Decision

Add integration tests in `tests/integration/a2a.integration.spec.ts` covering:

### Test Matrix

| Scenario | Transport | Validates |
|---|---|---|
| Send message, receive completed task | JSON-RPC | Full request → executor → task store → response |
| Send message, receive completed task | REST | Same flow, HTTP+JSON binding |
| Stream message, receive SSE events | JSON-RPC | SSE framing, event ordering (task → working → completed) |
| Cancel in-flight task | JSON-RPC | cancelTask flow, executor `isCancelled()` |
| Get task by ID | REST | Task store persistence within session |
| Agent Card served at well-known path | HTTP GET | Card content matches `buildAgentCard` output |
| Error in executor propagates as failed task | JSON-RPC | Error handling, failed status event |
| Push notification delivery | JSON-RPC + webhook | `DefaultPushNotificationSender` delivers to mock receiver |

### Test Infrastructure

```
tests/integration/a2a.integration.spec.ts
tests/integration/helpers/a2a-test-server.ts   // Boots A2AServer on random port
tests/integration/helpers/a2a-test-client.ts    // SDK A2AClient pointing at test server
tests/integration/helpers/webhook-receiver.ts   // Mini HTTP server for push notifications
```

- Each test suite starts a fresh `A2AServer` on port 0 (random) with a controllable `AnvioMessageHandler`.
- Handler behavior is injected per-test: immediate complete, delayed complete, throw error, block until signaled.
- Cleanup via `afterEach` guarantees port release.
- Tests use the SDK `A2AClient` (from `packages/a2a/src/client`) as the client, ensuring client↔server compatibility.

### What We Don't Test Here

- Gateway routing (`/a2a/*` prefix stripping) — that's gateway-level, tested separately.
- Authentication — deferred to ADR-0031.
- Multi-agent delegation chains — deferred to ADR-0029.

## Consequences

### Positive

- Catches SDK version upgrade regressions (protobuf schema changes, transport behavior).
- Validates SSE streaming works end-to-end, not just event construction.
- Push notification flow verified with real HTTP delivery.
- Serves as executable documentation of the A2A protocol surface.

### Negative

- Integration tests are slower (~2-5s for server boot/teardown cycles).
- Requires `pnpm build` before running (turbo `test` task already depends on `^build`).
- Random port allocation may conflict in constrained CI environments (mitigated by port 0 + retry).

### Risks

- SDK internal behavior may change between versions — tests may need updating when bumping `@a2a-js/sdk`.
- SSE streaming tests are timing-sensitive; need reasonable timeouts (5s default, configurable via env).
