# A2A Protocol Integration

**Status:** shipped (v2.4.0) · **ADR:** [0026](../docs/adr/0026-a2a-protocol-integration.md)

Anvio implements [Google's Agent-to-Agent (A2A) protocol v1.0](https://a2a-protocol.org/latest/) for cross-platform agent interoperability. Where MCP connects agents to **tools** and ACP connects agents to **editors**, A2A connects agents to **other agents**.

## Protocol Overview

| Concept | Description |
|---------|-------------|
| **Agent Card** | JSON discovery document at `/.well-known/agent.json` describing capabilities, skills, and auth |
| **Task** | Unit of work with lifecycle states: `submitted → working → completed/failed/canceled` |
| **Message** | Multi-part payload (text, file, data) exchanged between agents |
| **Artifact** | Structured output produced by a task |
| **Streaming** | Server-Sent Events for real-time task status and artifact updates |
| **Push Notifications** | Webhook-based event delivery for long-running tasks |

## Package Structure

```
packages/a2a/
├── src/
│   ├── types/           # A2A protocol types (Agent Card, Task, Message, etc.)
│   ├── server/          # A2A Server implementation
│   │   ├── a2a-server.ts        # JSON-RPC 2.0 + REST router
│   │   ├── task-manager.ts      # In-memory task store with state machine
│   │   ├── agent-card-builder.ts # Anvio AgentDefinition → A2A Agent Card
│   │   ├── sse-stream.ts        # SSE response wrapper
│   │   └── push-notifier.ts     # Webhook push notification delivery
│   ├── client/          # A2A Client implementation
│   │   ├── a2a-client.ts        # JSON-RPC transport with auth
│   │   ├── agent-discovery.ts   # Agent Card fetch with TTL cache
│   │   └── a2a-tool.ts          # Wraps client as Anvio ToolPort
│   └── mapping/         # Bidirectional converters
│       ├── session-to-task.ts   # AgentRunStatus ↔ TaskState
│       └── message-adapter.ts   # ChatMessage ↔ A2A Message
```

## Two Surfaces

### 1. A2A Server — Expose Anvio Agents

External A2A clients can discover and interact with your Anvio agents via standard A2A endpoints.

**Endpoints exposed through the Unified Gateway:**

| Route | Method | Description |
|-------|--------|-------------|
| `/.well-known/agent.json` | GET | Agent Card discovery |
| `/a2a` | POST | JSON-RPC 2.0 endpoint |
| `/a2a/health` | GET | Protocol health check |
| `/a2a/messages` | POST | REST: send message (create/continue task) |
| `/a2a/messages:stream` | POST | REST: send message with SSE streaming |
| `/a2a/tasks` | GET | REST: list tasks (paginated) |
| `/a2a/tasks/:id` | GET | REST: get task by ID |
| `/a2a/tasks/:id:cancel` | POST | REST: cancel a running task |
| `/a2a/tasks/:id:subscribe` | GET | SSE: subscribe to task updates |

**JSON-RPC 2.0 methods:**

- `sendMessage` — send a message and receive the task result
- `sendMessageStream` — send a message with SSE streaming response
- `getTask` — retrieve a task by ID
- `listTasks` — list tasks with pagination
- `cancelTask` — cancel a running task
- `setPushNotificationConfig` / `getPushNotificationConfig` / `deletePushNotificationConfig` — manage webhook notifications

### 2. A2A Client — Delegate to External Agents

Use `A2ATool` to register external A2A agents as tools available to your Anvio agents.

```typescript
import { A2AClient, A2ATool, AgentDiscovery } from '@anvio/a2a';

// Discover an external agent
const discovery = new AgentDiscovery();
const card = await discovery.discover('https://external-agent.example.com');

// Create a client
const client = new A2AClient({
  baseUrl: 'https://external-agent.example.com',
  auth: { type: 'bearer', token: 'your-api-key' },
});

// Wrap as an Anvio tool
const tool = new A2ATool(client, card);
const result = await tool.invoke('Analyze this dataset', 'context-123');
// result: { taskId, status, content }
```

## Quick Start

### Enabling A2A Server

The A2A server integrates with the Unified Gateway. When `platform.a2aServer` is set during platform boot, the gateway automatically routes A2A traffic:

```typescript
// In your platform boot sequence
import { A2AServer } from '@anvio/a2a';

const a2aServer = new A2AServer({
  host: '0.0.0.0',
  port: 0, // use gateway's port
  agents: loadedAgents,
  cardOptions: { baseUrl: 'https://your-domain.com' },
  onMessage: async (taskId, message, taskManager) => {
    // Bridge to Anvio's agent runtime
    const session = await createSessionFromA2AMessage(message);
    const result = await runtime.run(session);
    taskManager.updateStatus(taskId, 'completed');
  },
});

// Attach to platform context — gateway picks it up automatically
platformContext.a2aServer = a2aServer;
```

### Agent Card Generation

Agent Cards are automatically built from Anvio `AgentDefinition` frontmatter:

```yaml
# workspace/agents/researcher.md
---
persona: Research Agent
description: Finds and summarizes information from multiple sources
skills:
  - web-search
  - summarize
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
---
```

This generates an Agent Card at `/.well-known/agent.json`:

```json
{
  "agentId": "researcher",
  "name": "researcher",
  "description": "Finds and summarizes information from multiple sources",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "multiTurn": true
  },
  "skills": [
    { "id": "web-search", "name": "web-search" },
    { "id": "summarize", "name": "summarize" }
  ],
  "interfaces": [
    { "type": "json-rpc", "url": "https://your-domain.com/a2a" },
    { "type": "http+json", "url": "https://your-domain.com/a2a/messages" }
  ]
}
```

## State Mapping

Anvio session states map to A2A task states:

| Anvio `AgentRunStatus` | A2A `TaskState` | Direction |
|------------------------|-----------------|-----------|
| `idle` | `submitted` | ↔ |
| `calling_model` | `working` | → |
| `executing_tool` | `working` | → |
| `awaiting_approval` | `input_required` | ↔ |
| `completed` | `completed` | ↔ |
| `failed` | `failed` | ↔ |
| `canceled` | `canceled` | ↔ |

## Message Conversion

Anvio `ChatMessage` ↔ A2A `Message` conversion preserves:

- **Text content** — `ChatMessage.content` ↔ `TextPart`
- **Tool results** — serialized as `DataPart` with `mimeType: application/json`
- **Roles** — `user`/`assistant` ↔ `user`/`agent`
- **Message IDs** — preserved bidirectionally

## Streaming

SSE streaming delivers real-time updates during task execution:

```
POST /a2a/messages:stream
Content-Type: application/json

{"message": {"messageId": "m1", "role": "user", "parts": [{"type": "text", "text": "Hello"}]}}
```

Response (SSE):

```
event: status
data: {"taskId": "task_abc", "status": {"state": "working"}, "final": false}

event: artifact
data: {"taskId": "task_abc", "artifact": {"artifactId": "a1", "parts": [{"type": "text", "text": "..."}]}}

event: status
data: {"taskId": "task_abc", "status": {"state": "completed"}, "final": true}
```

## Push Notifications

For long-running tasks, configure webhook delivery:

```bash
# Set push notification config for a task
curl -X PUT https://your-domain.com/a2a/tasks/task_abc/pushNotificationConfigs \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-callback.com/webhook",
    "authentication": {
      "type": "bearer",
      "token": "callback-secret"
    }
  }'
```

Events are POSTed to the webhook URL with the configured authentication headers.

## Security

A2A supports multiple authentication schemes on Agent Cards:

- **API Key** — `x-api-key` header
- **Bearer Token** — `Authorization: Bearer <token>`
- **OAuth 2.0** — full OAuth flow with scopes
- **OpenID Connect** — OIDC discovery
- **Mutual TLS** — certificate-based

The `A2AClient` supports `bearer` and `apiKey` auth out of the box. For OAuth/OIDC, provide pre-acquired tokens.

## Architecture Integration

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  External    │────▶│  Unified     │────▶│  A2A Server  │
│  A2A Client  │     │  Gateway     │     │  (packages/  │
│              │◀────│  (gateway-   │◀────│   a2a)       │
└─────────────┘     │   http.ts)   │     └──────┬───────┘
                    └──────────────┘            │
                                               ▼
                                    ┌──────────────────┐
                                    │  Anvio Agent      │
                                    │  Runtime          │
                                    │  (packages/agents)│
                                    └──────────────────┘

┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Anvio Agent │────▶│  A2A Tool    │────▶│  External    │
│  (tool loop) │     │  (A2ATool)   │     │  A2A Agent   │
│              │◀────│              │◀────│              │
└─────────────┘     └──────────────┘     └──────────────┘
```

**Dependency graph** — clean, no circular deps:

```
packages/a2a  ──depends──▶  packages/core (types only)
packages/platform  ──duck-typed──▶  packages/a2a (optional interface)
apps/gateway  ──via platform──▶  packages/a2a
```

## MCP vs A2A vs ACP

| Protocol | Purpose | Anvio Package | Analogy |
|----------|---------|---------------|---------|
| **MCP** | Agent ↔ Tool | `packages/integrations` | USB peripheral |
| **A2A** | Agent ↔ Agent | `packages/a2a` | Network socket |
| **ACP** | Agent ↔ Editor | `packages/acp` | IDE extension |

## Testing

```bash
# Run all A2A tests (31 tests)
npx vitest run packages/a2a/src/

# Individual test suites
npx vitest run packages/a2a/src/task-manager.spec.ts      # 10 tests
npx vitest run packages/a2a/src/agent-card-builder.spec.ts # 2 tests
npx vitest run packages/a2a/src/mapping.spec.ts            # 12 tests
npx vitest run packages/a2a/src/a2a-server.spec.ts         # 7 tests
```
