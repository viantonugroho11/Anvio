# Agent Runtime

## State Machine

idle → assembling_context → calling_model → [tool_executing]* → awaiting_approval → storing_memory → completed | failed

## Channel-Agnostic Execution

Runtime never imports channel code. All outbound communication flows through events → Channel Hub → adapters.

## Detached / Background Sessions

When `detached: true`, worker executes independently of client connection. Progress and completion delivered via channel adapters and notifications.

## Progress Streaming

Runtime yields `progress` events during context assembly, model calls, and memory storage. Worker publishes `AGENT_RUN_PROGRESS` for all channels.

## Agent Inbox

Mid-run instructions injected via inbox queue. Worker drains inbox on `AGENT_INBOX_INJECTED` and re-queues agent runs or stops sessions.

## Approval Workflow

Runtime pauses at `awaiting_approval`. Resume via `runtime.resume(session, agent, decision)` after `APPROVAL_DECIDED` event.

## Orchestration Patterns

- **Single Agent** — default `runtime.run` / `runtime.stream`
- **Supervisor** — `SupervisorOrchestrator` delegates to subagents
- **Parallel / Fan-out** — concurrent subagent execution
- **Fan-in** — manager synthesizes subagent results
- **Hierarchical** — nested orchestration plans (Phase 4)

## Responsibilities

- Agent lifecycle (including `stop`)
- Context assembly
- Tool execution
- Delegation via orchestrator
- Session restoration via thread mapping

## CLI Command Center

```bash
anvio run <agent> [message] [--detach]
anvio sessions | anvio status | anvio logs
anvio approve | anvio stop | anvio inbox
```

See `docs/10-channels.md` for full Channel Hub documentation.
