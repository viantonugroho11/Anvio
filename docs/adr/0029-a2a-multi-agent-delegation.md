# ADR-0029: Multi-Agent Delegation via A2A Tool

**Status:** Accepted  
**Date:** 2026-09-12  
**Deciders:** Platform team, tool gateway maintainers  
**Supersedes:** —  
**Related:** ADR-0026 (A2A Protocol Integration), ADR-0028 (A2A Platform Wiring)

## Context

`packages/a2a/src/client/a2a-tool.ts` provides `A2ATool` — a wrapper that calls an external A2A agent and returns the result as text. However, this tool is **not registered in `packages/tools`** (the tool gateway), so no Anvio agent can use it.

Anvio agents already delegate via the `orchestration.delegates` pattern in agent definitions, but this is internal-only (same workspace, same process). A2A delegation enables:

1. **Cross-workspace delegation** — Agent A in workspace X delegates to Agent B in workspace Y.
2. **Cross-framework delegation** — Anvio agent delegates to a LangChain/CrewAI/AutoGen agent that speaks A2A.
3. **External service delegation** — Anvio agent delegates to a SaaS that exposes an A2A endpoint.

### Forces

1. Tool gateway (`packages/tools`) is the single registration point for all tools available to agents.
2. Tools are declared in agent definitions: `tools: ['web_fetch', 'a2a:research-agent']`.
3. `A2ATool` already handles invoke → format result. Just needs gateway registration.
4. Streaming delegation (agent proxies SSE from delegate) is complex — start with synchronous.
5. Discovery: agents need to know which A2A endpoints exist. Could be configured in `anvio.yaml` or discovered dynamically.

## Decision

### 1. A2A Tool Registration in Tool Gateway

Register A2A tools as a new tool category in `packages/tools`:

```yaml
# anvio.yaml
a2a:
  remotes:
    - alias: research-bot
      url: https://research.example.com
      apiKey: ${A2A_RESEARCH_KEY}
      description: 'Delegates research tasks to external research agent'
    - alias: code-reviewer
      url: https://review.internal:3001
      bearerToken: ${A2A_REVIEW_TOKEN}
```

Each remote becomes a tool named `a2a:{alias}` (e.g., `a2a:research-bot`).

### 2. Tool Gateway Integration (`packages/tools`)

```typescript
// packages/tools/src/builtin/a2a-delegate.ts
export class A2ADelegateToolProvider implements ToolProvider {
  readonly category = 'a2a';
  
  constructor(private readonly remotes: A2ARemoteConfig[]) {}
  
  listTools(): ToolDefinition[] {
    return this.remotes.map(r => ({
      name: `a2a:${r.alias}`,
      description: r.description ?? `Delegate to A2A agent: ${r.alias}`,
      parameters: {
        message: { type: 'string', description: 'Message to send to the agent' },
        contextId: { type: 'string', description: 'Optional conversation context ID', optional: true },
      },
    }));
  }
  
  async execute(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const alias = toolName.replace('a2a:', '');
    const tool = this.tools.get(alias);
    const result = await tool.invoke(params.message as string, params.contextId as string);
    return { content: result.content, metadata: { taskId: result.taskId, status: result.status } };
  }
}
```

### 3. Agent Definition Usage

```yaml
# workspace/agents/orchestrator.md
---
persona: orchestrator
tools: ['a2a:research-bot', 'a2a:code-reviewer', 'web_fetch']
orchestration:
  pattern: single
---
You can delegate research tasks using the a2a:research-bot tool 
and code reviews using a2a:code-reviewer.
```

### 4. Local Agent-to-Agent (Same Workspace)

For agents in the same workspace, A2A is overkill (HTTP round-trip to self). But for consistency, local agents can also be referenced as `a2a:local:{agent-name}`, which bypasses HTTP and calls the agent runner directly. This is a future optimization — initial implementation always goes over HTTP.

### 5. What's Deferred

- **Streaming delegation**: Agent proxies SSE from delegate in real-time. Complex (backpressure, error propagation). Phase 2.
- **Dynamic discovery**: Agent discovers available A2A endpoints at runtime via Agent Card crawling. Phase 2.
- **Delegation chains**: Agent A → Agent B → Agent C with context propagation. Needs `referenceTaskIds` support. Phase 2.
- **Approval forwarding**: Delegate requests human approval — how does that bubble up? Phase 2.

## Consequences

### Positive

- Any Anvio agent can delegate to any A2A-compatible agent with one line in `tools:`.
- Consistent with existing tool model — no new concepts for agent authors.
- Credentials managed per-remote in `anvio.yaml`, not per-agent.
- Works cross-framework: LangChain, CrewAI, AutoGen agents accessible if they serve A2A.

### Negative

- Synchronous-only initially — agent blocks waiting for delegate response (mitigated by tool loop timeout).
- HTTP overhead for same-workspace delegation (mitigated later by local shortcut).
- Remote A2A endpoints must be pre-configured — no runtime discovery yet.

### Risks

- Delegation loops (Agent A delegates to Agent B which delegates back to Agent A). Must detect and break cycles via `referenceTaskIds` or depth limit.
- Credential leakage if `anvio.yaml` is committed with inline secrets. Should support `${ENV_VAR}` interpolation (already standard in Anvio config).
- Timeout handling: delegate may run for minutes. Need configurable per-remote timeout (default 120s).
