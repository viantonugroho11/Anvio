# ADR 0008: Channel Hub Architecture

## Status

Accepted

## Context

Users need remote agent interaction similar to modern agent orchestration systems (e.g. Claude-inspired workflows), but Anvio explicitly must **not** couple to Slack or any single communication platform.

Requirements include:

- Multiple channels (Telegram, WhatsApp, Discord, Slack, Web Chat, REST, CLI)
- Thread-based sessions with resume
- Background/detached execution
- Progress streaming and notifications
- Agent inbox for mid-run instructions
- Human approval workflow
- Multi-agent coordination
- CLI-first command center

## Decision

Adopt a **Channel Hub** pattern:

1. **`ChannelAdapter`** — transport-only interface in `@anvio/core`. Optional methods for progress, notifications, and approvals.
2. **`ChannelHub`** — registers adapters and routes outbound events from runtime/worker without channel-specific logic in the agent engine.
3. **Event-driven glue** — worker subscribes to `AGENT_RUN_*`, `APPROVAL_*`, `AGENT_INBOX_*` events and dispatches through the hub.
4. **Session as universal thread** — `StoredSession.channelThread` maps external thread IDs; `detached` enables background runs.
5. **Agent Inbox** — in-process queue (`LocalAgentInbox`) for injecting instructions into active sessions.
6. **SupervisorOrchestrator** — manager/subagent patterns (sequential, parallel, fan-out, fan-in) without channel awareness.

Slack, Telegram, Discord, and WhatsApp ship as **stub adapters** — real SDK wiring is configuration-driven per deployment.

## Consequences

### Positive

- Runtime remains channel-agnostic; new channels are adapter-only work.
- Identical flow across all surfaces: create task → background execution → progress → approval → notification.
- CLI command center provides full platform access without Web UI.
- Aligns with local-first vision (ADR 0007): filesystem sessions, optional NATS for scale.

### Negative

- Stub adapters require per-channel integration effort before production use.
- In-process inbox does not survive process restart (Level 3: persist to session store or Redis).

**Update (implemented):** `FilesystemAgentInbox` persists to `workspace/inbox/<sessionId>.json`.
- Approval UX varies by channel; adapters must render platform-native buttons where available.

## Alternatives Rejected

- **Slack-first architecture** — violates non-goals in vision doc.
- **Channel logic in AgentRuntime** — couples domain to transport; rejected.
- **Separate runtime per channel** — duplicates orchestration; rejected.

## Implementation Map

| Component              | Location                              |
|------------------------|---------------------------------------|
| Ports & types          | `packages/core/`                      |
| Channel Hub & adapters | `packages/channels/`                  |
| Orchestrator           | `packages/agents/src/orchestrator.ts` |
| Worker dispatch        | `apps/worker/src/main.ts`             |
| CLI Command Center     | `apps/cli/src/main.ts`                |
| Artifacts              | `packages/workspace/` (FilesystemArtifactStore) |

## References

- `docs/10-channels.md`
- ADR 0007: Local-First Architecture
