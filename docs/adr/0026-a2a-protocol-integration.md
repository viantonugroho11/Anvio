# ADR-0026: A2A Protocol Integration (Agent-to-Agent)

**Status:** Proposed  
**Date:** 2026-09-08  
**Deciders:** Platform team, agent runtime maintainers

## Context

Anvio has MCP for agent-to-tool communication (`packages/integrations`) and a proprietary ACP server (`packages/acp`) for editor integration (Cursor, etc.). Neither addresses **agent-to-agent interoperability** with external ecosystems.

[A2A (Agent-to-Agent Protocol)](https://a2a-protocol.org/latest/) is an open standard (v1.0, Google-led) for cross-framework agent communication. It provides:

- **Agent Cards** — discovery metadata (capabilities, skills, auth, endpoints)
- **Tasks** — lifecycle-managed work units with 9 states (submitted → working → completed/failed/canceled/input_required/auth_required/rejected)
- **Messages** — multi-part (text/file/data) payloads with roles (user/agent)
- **Artifacts** — structured outputs produced by tasks
- **Streaming** — SSE for real-time status/artifact updates
- **Push notifications** — webhook delivery for async task updates
- **Three bindings** — JSON-RPC 2.0, HTTP+JSON/REST, gRPC

A2A complements MCP: MCP connects agents to tools; A2A connects agents to agents. Adding A2A lets Anvio agents both **serve** external callers and **delegate** to external A2A agents.

### Forces

1. Anvio agents already run multi-turn tool loops — A2A's Task model maps naturally onto `packages/agents`' session/run lifecycle.
2. `packages/channels` handles 14+ inbound transports — A2A is effectively another inbound channel.
3. `packages/tools` is the outbound tool gateway — an A2A client tool fits here as a new tool type.
4. The existing `packages/acp` is narrow (prompt/response, no task lifecycle, no discovery). A2A subsumes it for agent-to-agent use; ACP remains for editor-specific integration.
5. Anvio's progressive tiers mean A2A must work at Level 1 (filesystem, no DB).

## Decision

Create a new `packages/a2a` package implementing the A2A v1.0 specification with two surfaces:

1. **A2A Server** — exposes Anvio agents as A2A-compliant endpoints
2. **A2A Client** — lets Anvio agents invoke external A2A agents as tools

### Package Structure

```
packages/a2a/
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── agent-card.ts          # AgentCard, AgentSkill, AgentCapabilities
│   │   ├── task.ts                # Task, TaskStatus, TaskState
│   │   ├── message.ts             # Message, Part, Role
│   │   ├── artifact.ts            # Artifact
│   │   ├── push-notification.ts   # TaskPushNotificationConfig
│   │   ├── errors.ts              # A2A error codes
│   │   └── index.ts
│   ├── server/
│   │   ├── a2a-server.ts          # HTTP server (JSON-RPC + REST bindings)
│   │   ├── agent-card-builder.ts  # Build AgentCard from AgentDefinition
│   │   ├── task-manager.ts        # Task lifecycle, state machine
│   │   ├── sse-stream.ts          # SSE streaming for subscribeToTask
│   │   └── push-notifier.ts       # Webhook delivery
│   ├── client/
│   │   ├── a2a-client.ts          # HTTP client for external A2A agents
│   │   ├── agent-discovery.ts     # Fetch + cache AgentCards
│   │   └── a2a-tool.ts            # Tool wrapper for packages/tools registry
│   └── mapping/
│       ├── session-to-task.ts     # Map Anvio Session ↔ A2A Task
│       └── message-adapter.ts     # Map UserInput/AgentStreamEvent ↔ A2A Message/Part
```

### Dependency Graph

```
packages/a2a → packages/core (types, ports)
                packages/agents (session orchestration, for server)
                packages/tools (tool registry, for client tool)
apps/gateway → packages/a2a (mount A2A server alongside existing HTTP)
```

No dependency on `packages/db` — tasks stored in-memory or filesystem at Level 1, PostgreSQL at Level 3+.

## Options Considered

### Option A: New `packages/a2a` (chosen)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — new package, but maps cleanly onto existing session/tool abstractions |
| Scope | Full A2A v1.0 — JSON-RPC + REST bindings, streaming, push notifications |
| Reuse | Server reuses `packages/agents` orchestration; client reuses `packages/tools` registry |
| Tier compat | Level 1 compatible (in-memory task store, filesystem fallback) |

**Pros:**
- Clean separation from ACP (editor integration stays untouched)
- Full spec compliance enables ecosystem interop (Google ADK, LangGraph, CrewAI, etc.)
- Agent Card auto-generated from existing `AgentDefinition` frontmatter + skills
- Task lifecycle maps 1:1 onto Anvio session states

**Cons:**
- New package to maintain
- A2A spec is young (v1.0) — may evolve

### Option B: Extend `packages/acp` to support A2A

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — ACP's simple prompt/response model diverges significantly from A2A's Task lifecycle |
| Scope | Would require rewriting ACP internals |
| Reuse | Breaks existing editor integration contracts |
| Tier compat | Same |

**Pros:**
- One fewer package
- Reuses existing HTTP server code

**Cons:**
- ACP and A2A serve different purposes (editor vs. agent interop)
- Coupling risks breaking Cursor/editor integration
- ACP's simple types don't accommodate A2A's rich model

### Option C: A2A as a Channel adapter in `packages/channels`

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low for inbound, but client side doesn't fit the channel model |
| Scope | Server only — no client/tool surface |
| Reuse | Channel adapter pattern handles inbound well |
| Tier compat | Same |

**Pros:**
- Fast for server side — channel adapters are well-understood
- Reuses channel hub routing

**Cons:**
- A2A client (outbound agent delegation) doesn't fit channels
- Agent Card serving needs its own endpoint, not channel-shaped
- Task lifecycle management exceeds channel adapter scope

## Trade-off Analysis

**Option A wins** because A2A is both inbound (server) and outbound (client). Channels only solve inbound. ACP serves a different purpose. A dedicated package keeps boundaries clean and allows full spec compliance without contaminating existing abstractions.

The key design decisions within Option A:

1. **Task ↔ Session mapping**: A2A `Task.id` maps to Anvio `Session.id`. A2A `contextId` maps to Anvio thread/conversation scope. Task state machine wraps session status.

2. **Agent Card generation**: Auto-build from `AgentDefinition` frontmatter — `persona` → `description`, `skills` array → `AgentSkill[]`, model capabilities → `AgentCapabilities`.

3. **Client as tool**: Register external A2A agents as tools via `anvio.yaml`:
   ```yaml
   a2a:
     remotes:
       - url: https://partner.example.com/.well-known/agent.json
         alias: partner-researcher
   ```
   Each remote becomes an `a2a_delegate` tool available to agents.

4. **Streaming**: A2A SSE maps directly onto Anvio's `AgentStreamEvent` pattern. Server translates `AgentStreamEvent` → `TaskStatusUpdateEvent` / `TaskArtifactUpdateEvent`.

5. **Auth**: Support `apiKey` and `bearer` schemes initially. OAuth2 flows deferred to Level 3+ (requires persistent token storage).

## Consequences

### What becomes easier
- Anvio agents discoverable and invocable by any A2A-compliant system
- Multi-agent orchestration across frameworks (Google ADK agents calling Anvio agents and vice versa)
- Agent marketplace/registry participation via standard Agent Cards

### What becomes harder
- Two agent-communication protocols to maintain (ACP for editors, A2A for agents)
- Task state synchronization between A2A task model and Anvio session model adds mapping complexity

### What we'll need to revisit
- ACP deprecation path — once A2A matures, evaluate whether ACP can be retired or adapted
- gRPC binding — defer to post-MVP; JSON-RPC + REST cover most clients
- Multi-tenant task isolation at Level 3+
- Agent Card signing (RS256/ES256) — requires key management, defer to post-MVP

## Action Items

1. [ ] Create `packages/a2a` with types from A2A v1.0 spec (Zod schemas in `packages/core`)
2. [ ] Implement A2A Server with JSON-RPC + REST bindings, task lifecycle, SSE streaming
3. [ ] Build Agent Card auto-generator from `AgentDefinition`
4. [ ] Implement A2A Client + `a2a_delegate` tool type in `packages/tools`
5. [ ] Mount A2A server in `apps/gateway` on configurable path (default: `/a2a`)
6. [ ] Add `a2a` section to `anvio.yaml` workspace schema
7. [ ] Serve `/.well-known/agent.json` for Agent Card discovery
8. [ ] Write integration tests against a mock A2A peer
9. [ ] Document in `docs/` — architecture, configuration, usage examples
