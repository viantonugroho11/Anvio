# ADR-0030: A2A Gateway SSE Streaming Support

**Status:** Accepted  
**Date:** 2026-09-12  
**Deciders:** Platform team, gateway maintainers  
**Supersedes:** —  
**Related:** ADR-0026 (A2A Protocol Integration), ADR-0028 (A2A Platform Wiring)

## Context

The A2A SDK supports Server-Sent Events (SSE) streaming for `sendMessage` (via `sendMessageStream`). When a client sends a message with streaming enabled, the server holds the connection open and pushes `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` as SSE frames.

The SDK's Express transport handlers (`jsonRpcHandler`, `restHandler`) handle SSE natively — they detect streaming requests and write SSE frames to the response. However, Anvio's unified gateway (`apps/gateway/src/gateway-http.ts`) uses raw `node:http` and delegates to `A2AServer.handleRequest()`.

### Current Problem

`handleRequest()` pipes the raw `req`/`res` into an Express app. For regular request/response this works. For SSE streaming, potential issues:

1. **Response buffering**: Node.js HTTP or reverse proxies (nginx, cloudflare) may buffer the response, delaying SSE frames.
2. **Connection timeout**: Gateway or infrastructure may time out long-lived SSE connections.
3. **Backpressure**: If the Anvio agent produces events faster than the client consumes, the response stream needs backpressure handling.
4. **Gateway health checks**: Long-lived connections shouldn't count against concurrency limits or be killed by health-check timeouts.
5. **Graceful shutdown**: Gateway must drain SSE connections on shutdown rather than abruptly closing them.

### Forces

1. SDK handles SSE framing internally — we don't need to implement SSE ourselves.
2. Gateway is the entry point for external clients — it must support streaming or external clients can't use it.
3. `node:http` supports streaming natively — no fundamental blocker.
4. Multiple SSE connections per client are expected (one per in-flight task).

## Decision

### 1. Disable Response Buffering for A2A Routes

In `gateway-http.ts`, when routing to A2A:

```typescript
if (pathname.startsWith('/a2a') || pathname === '/.well-known/agent.json') {
  // Disable Nagle's algorithm for SSE
  res.socket?.setNoDelay(true);
  // Signal proxies not to buffer
  res.setHeader('X-Accel-Buffering', 'no');  // nginx
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  
  const handled = await platformContext.a2aServer.handleRequest(req, res, pathname);
  if (handled) return;
}
```

### 2. Connection Timeout Management

- Gateway default timeout: 120s for regular requests.
- A2A SSE connections: extend to 30 minutes (`res.setTimeout(30 * 60 * 1000)`).
- SDK sends periodic `:keepalive` comments (every 15s) to prevent intermediate proxy timeouts.
- Client-side: SDK `A2AClient` reconnects on disconnect (built-in).

### 3. Graceful Shutdown

On `SIGTERM`/`SIGINT`:

1. Gateway stops accepting new connections.
2. Active SSE connections receive a final `TaskStatusUpdateEvent` with current state.
3. Wait up to 10s for in-flight tasks to complete.
4. Force-close remaining SSE connections.

```typescript
process.on('SIGTERM', async () => {
  gateway.stopAccepting();
  await gateway.drainConnections(10_000);
  await platformContext.a2aServer?.stop();
  process.exit(0);
});
```

### 4. Concurrency Limits

- Track active SSE connections separately from request/response connections.
- Default limit: 100 concurrent SSE connections per gateway instance.
- Configurable via `anvio.yaml`:

```yaml
gateway:
  a2a:
    maxStreamingConnections: 100
    streamingTimeoutMs: 1800000  # 30 minutes
```

### 5. What the SDK Already Handles

- SSE frame formatting (`data:`, `event:`, `id:` fields)
- Content-Type `text/event-stream`
- Task event ordering (task → statusUpdate → artifactUpdate)
- Client reconnection with `Last-Event-ID`

We do NOT reimplement any of these.

## Consequences

### Positive

- External A2A clients get real-time task updates without polling.
- Minimal code — SDK does the heavy lifting; gateway just avoids interfering.
- Proxy-friendly headers ensure streaming works behind nginx/cloudflare.
- Graceful shutdown prevents data loss on deploy.

### Negative

- Long-lived connections consume server resources (file descriptors, memory).
- Monitoring complexity: need to distinguish SSE connections from stuck requests in health checks.
- Reverse proxy configuration may still need tuning per deployment.

### Risks

- Memory leak if SSE connections are not properly cleaned up on client disconnect. SDK's Express handler should handle this, but needs verification (ADR-0027 integration tests).
- High-frequency events (e.g., per-token streaming) may overwhelm slow clients. Backpressure is handled by Node.js stream primitives, but should be load-tested.
