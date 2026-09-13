# ADR-0028: Wire A2A Server into Platform Context and Gateway

**Status:** Accepted  
**Date:** 2026-09-12  
**Deciders:** Platform team, gateway maintainers  
**Supersedes:** —  
**Related:** ADR-0026 (A2A Protocol Integration)

## Context

`packages/a2a` provides `A2AServer` backed by the official SDK, and `packages/platform`'s `PlatformContext` already has a duck-typed `a2aServer?: { handleRequest(...) }` slot. The unified gateway (`gateway-http.ts`) routes `/a2a/*` and `/.well-known/agent.json` to this slot when present.

However, **nothing instantiates `A2AServer` from configuration**. Users must manually construct and wire it. This means:

1. A2A is effectively dead code at the platform level — gateway routes exist but `a2aServer` is always `undefined`.
2. No `anvio.yaml` knob to enable/disable A2A.
3. Agent definitions aren't automatically exposed as A2A Agent Cards.
4. The `AnvioMessageHandler` bridge to `packages/agents` runtime doesn't exist yet.

### Forces

1. **Dependency rule**: `platform → packages → core`. Platform can import `@anvio/a2a` directly (it's a package).
2. **Progressive tiers**: A2A must work at Level 1 (no DB). `InMemoryTaskStore` satisfies this.
3. **Multi-agent**: A workspace may define multiple agents. Each could have its own Agent Card, or one card could represent the workspace.
4. **Handler bridge**: `AnvioMessageHandler` receives `(RequestContext, ExecutionEventBus)`. It must translate into an Anvio agent session run via `packages/agents`.

## Decision

### 1. Configuration in `anvio.yaml`

```yaml
a2a:
  enabled: true                    # default: false
  host: 0.0.0.0                   # default: same as gateway
  port: 3001                      # default: same as gateway (shared)
  agents: ['*']                   # which agents to expose; '*' = all, or list names
  provider:
    organization: 'My Org'
    url: 'https://example.com'
  pushNotifications: true         # default: true
```

When `a2a.enabled: true`, platform instantiates `A2AServer` during boot and injects into `PlatformContext.a2aServer`.

### 2. Platform Bootstrap (`packages/platform/src/a2a-bootstrap.ts`)

```typescript
export async function bootstrapA2A(
  config: A2AConfig,
  agents: AgentDefinition[],
  agentRunner: AgentRunner,
): Promise<A2AServer>
```

- Filters agents based on `config.agents` (glob or name list).
- Creates `AnvioMessageHandler` that bridges to `agentRunner.run()`.
- Constructs `A2AServer` with filtered agents and handler.
- Does NOT call `server.start()` — gateway manages the HTTP listener.

### 3. Message Handler Bridge

The handler translates SDK's execution model to Anvio's agent runtime:

```
RequestContext.userMessage → ChatMessage
  → agentRunner.run(agentName, message, sessionId)
  → stream AgentStreamEvents
  → convert to AgentEvent.statusUpdate / AgentEvent.artifactUpdate
  → publish to ExecutionEventBus
```

Key mappings:
- `requestContext.taskId` → Anvio session ID (or create new session)
- `requestContext.contextId` → Anvio conversation thread
- `requestContext.userMessage` → `ChatMessage { role: 'user', content: textParts.join('\n') }`
- Agent stream `done` event → `TaskState.TASK_STATE_COMPLETED` + final artifact
- Agent stream `error` event → `TaskState.TASK_STATE_FAILED`
- Agent stream `approval_required` → `TaskState.TASK_STATE_INPUT_REQUIRED`

### 4. Gateway Integration

No changes needed — gateway already routes to `platformContext.a2aServer.handleRequest()`. Once platform populates the slot, it works.

### 5. Agent Card Auto-Generation

Each exposed agent gets an Agent Card at `/.well-known/agent.json`. For multi-agent workspaces, the card lists all exposed agents' skills. Future: per-agent cards at `/.well-known/agents/{name}.json`.

## Consequences

### Positive

- `anvio.yaml` → A2A server live. Zero code required from users.
- All workspace agents automatically discoverable via Agent Cards.
- Leverages existing gateway infrastructure — no new ports or servers.
- Handler bridge reuses `packages/agents` runtime, inheriting all tool loop, memory, and learning capabilities.

### Negative

- Platform gains a hard dependency on `@anvio/a2a` (acceptable per dependency rule).
- `InMemoryTaskStore` loses tasks on restart — acceptable at Level 1; Level 2+ can use persistent store later.
- Multi-agent card design is deferred (single card aggregating all agents for now).

### Risks

- Handler bridge must correctly map between Anvio's streaming model and SDK's event bus model — mismatch causes lost events or stuck tasks.
- Agent sessions created via A2A should be distinguishable from CLI/channel sessions for observability.
