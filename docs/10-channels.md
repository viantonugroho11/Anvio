# Channels — Channel Hub Architecture

Anvio treats every communication surface as a **transport layer only**. The Agent Runtime never imports channel-specific code.

## Design Principles

1. **Channel independence** — Telegram, WhatsApp, Discord, Slack, Web Chat, REST API, and CLI share identical runtime behavior.
2. **Thread → Session mapping** — External threads (Telegram topic, Discord thread, Slack thread, web conversation) map 1:1 to agent sessions.
3. **Detached execution** — Agents continue when users disconnect; completion flows through notifications.
4. **Adapter-only extension** — New channels implement `ChannelAdapter`; runtime logic stays unchanged.

## ChannelAdapter Interface

```typescript
interface ChannelAdapter {
  readonly channelType: ChannelType;
  sendMessage(sessionId, message): Promise<void>;
  sendProgress?(sessionId, update): Promise<void>;
  sendNotification?(sessionId, notification): Promise<void>;
  sendApprovalRequest?(sessionId, request): Promise<void>;
  onMessage(handler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

Implementations live in `packages/channels/`:

| Channel  | Adapter           | Status            |
| -------- | ----------------- | ----------------- |
| Web Chat | `WebChatChannel`  | Implemented       |
| CLI      | `CliChannel`      | Implemented       |
| REST API | `RestApiChannel`  | Implemented       |
| Telegram | `TelegramChannel` | Long-polling      |
| Discord  | `DiscordChannel`  | Gateway WS        |
| Slack    | `SlackChannel`    | Socket Mode       |
| WhatsApp | `WhatsAppChannel` | Cloud API webhook |

## Channel Hub

`ChannelHub` (`packages/channels/src/channel-hub.ts`) registers adapters and routes outbound events:

```
Agent Runtime / Worker
        ↓ events
   Channel Hub
   ↙ ↓ ↓ ↓ ↘
 CLI REST Web Telegram …
```

Inbound messages flow: `ChannelAdapter → EventBus → Worker → AgentRuntime`.

## Thread-Based Sessions

Sessions store `channelThread` metadata:

```json
{
  "channelThread": {
    "channel": "discord",
    "threadId": "1234567890"
  }
}
```

Resume a session via `SessionStore.getByChannelThread(channel, threadId)`.

Session payload includes: context (messages), progress (status), state, attachments (artifacts), approvals (`pendingApproval`).

## Background / Detached Sessions

Set `detached: true` when creating a session or publishing `AGENT_RUN_REQUESTED`. The worker executes independently; the user receives progress and completion via channel adapters.

```bash
anvio run architect "Review this repository" --detach
```

## Progress Streaming

Runtime emits `AGENT_RUN_PROGRESS` events. All adapters receive formatted updates:

```
🔄 Analyzing repository
🔄 Reading documentation
✅ Completed
```

## Agent Inbox

Inject instructions into running sessions:

```bash
anvio inbox <sessionId> "Focus on security issues first"
anvio inbox <sessionId> stop
```

Messages queue in `LocalAgentInbox` and dispatch via `AGENT_INBOX_INJECTED`.

## Human Approval Workflow

When a tool requires approval, runtime pauses with `awaiting_approval` status. Worker publishes `APPROVAL_REQUESTED`; adapters render Approve/Reject actions.

```bash
anvio approve <sessionId> <requestId>
anvio approve <sessionId> <requestId> --reject
```

## Notifications

| Type                | Trigger                   |
| ------------------- | ------------------------- |
| `task_completed`    | Agent run finished        |
| `task_failed`       | Agent run error           |
| `approval_required` | Tool needs human approval |
| `agent_waiting`     | Agent blocked on input    |
| `workflow_finished` | Orchestration complete    |

## Multi-Agent Coordination

`SupervisorOrchestrator` supports:

- **Sequential** — tasks run one after another
- **Parallel / Fan-out** — tasks run concurrently
- **Fan-in** — subagent results synthesized by manager

```typescript
createOrchestrationPlan('manager', 'parallel', [
  { agentId: 'architect', input: 'Design API' },
  { agentId: 'reviewer', input: 'Review design' },
]);
```

## Agent Workspace Layout

```
workspace/
  agents/
  sessions/
  memory/
  artifacts/       # Generated reports, diagrams, reviews
  worktrees/       # Git worktree isolation per agent
```

Coding agents receive isolated worktrees under `worktrees/<sessionId>/` to avoid file conflicts.

## Agent Artifacts

`FilesystemArtifactStore` persists markdown reports, reviews, and documentation under `artifacts/<sessionId>/`.

## Agent Command Center (CLI)

Entire platform usable without Web UI:

```bash
anvio run architect "Generate architecture report"
anvio run reviewer "Review PR #42" --detach
anvio sessions
anvio status
anvio logs <sessionId>
anvio approve <sessionId> <requestId>
anvio stop <sessionId>
anvio inbox <sessionId> "Ignore frontend code"
```

## Telegram Setup

Enable in `workspace/anvio.yaml`:

```yaml
spec:
  channels:
    telegram:
      enabled: true
      defaultAgent: architect
```

Set `TELEGRAM_BOT_TOKEN` in environment (recommended) or `botToken` in config.

Features:

- Long-polling via Telegram Bot API (no webhook required)
- Forum topic support via `message_thread_id`
- Inline Approve/Reject buttons for tool approvals

## Discord Setup

```yaml
spec:
  channels:
    discord:
      enabled: true
      defaultAgent: architect
```

Set `DISCORD_BOT_TOKEN` in environment. Enable **Message Content Intent** in Discord Developer Portal.

Features:

- Gateway WebSocket connection (native WebSocket, no discord.js)
- Thread channels map 1:1 to agent sessions
- Button components for approvals

## Slack Setup

```yaml
spec:
  channels:
    slack:
      enabled: true
      defaultAgent: architect
```

Environment:

- `SLACK_BOT_TOKEN` — Bot User OAuth Token (`xoxb-...`)
- `SLACK_APP_TOKEN` — App-Level Token with `connections:write` scope (`xapp-...`)

Features:

- **Socket Mode** — no public webhook URL required (local-first friendly)
- Slack thread `thread_ts` maps to agent session
- Block Kit Approve/Reject buttons

Enable Socket Mode in Slack app settings and subscribe to `message.channels`, `message.im`, `message.groups`.

## WhatsApp Setup

```yaml
spec:
  channels:
    whatsapp:
      enabled: true
      defaultAgent: architect
```

Environment:

- `WHATSAPP_ACCESS_TOKEN` — Meta Cloud API token
- `WHATSAPP_PHONE_NUMBER_ID` — Phone number ID from Meta Business
- `WHATSAPP_VERIFY_TOKEN` — **Required.** The string you enter in Meta's webhook configuration; the GET handshake fails without it. There is no default: one used to exist and was a published secret (issue #39).

Webhook URL (configure in Meta Developer Console):

```
https://<your-host>/api/channels/whatsapp/webhook
```

Run API alongside worker:

```bash
pnpm --filter @anvio/api dev
pnpm --filter @anvio/worker dev
```

Features:

- Inbound via Meta webhook
- Outbound via Graph API `v21.0`
- Interactive reply buttons for approvals
- Phone number → session mapping (`phone:{wa_id}`)

## Persistent Agent Inbox

Inbox messages persist to `workspace/inbox/<sessionId>.json` and survive process restart.

## Git Worktree Isolation

Enable in `workspace/anvio.yaml`:

```yaml
spec:
  worktrees:
    enabled: true
    repoPath: .. # git repo root relative to workspace
```

Agents with isolated workspace:

```yaml
# workspace/agents/coder.yaml
spec:
  workspace:
    isolatedWorktree: true
```

CLI:

```bash
anvio worktree list
anvio worktree create <sessionId>
anvio worktree remove <sessionId>
```

Each session gets `workspace/worktrees/<sessionId>/` on branch `anvio/agent-<id>`.

## Channel Health Check

Verify credentials and connectivity without starting the worker:

```bash
anvio channels status
anvio channels status --json
```

Status values:

- **healthy** — probe succeeded (API reachable, token valid)
- **degraded** — partially ready (e.g. WhatsApp API ok but webhook needs API running)
- **disabled** — not enabled in `anvio.yaml`
- **misconfigured** — enabled but missing env vars or config
- **unreachable** — enabled with credentials but API probe failed

## Adding a New Channel

1. Create `packages/channels/src/<channel>.ts` implementing `ChannelAdapter`.
2. Register in `createPlatform()` or channel config.
3. Map inbound webhooks/polling to `InboundMessage` with `channelThreadId`.
4. No changes to `packages/agents/` required.

Examples for future channels: Microsoft Teams, Matrix, Line, Signal, custom enterprise chat.

## Slash commands (v2.1.0)

Slash-prefixed messages (`/help`, `/agents`, `/skill code-review`, …) are
routed by a **workspace-scoped `SlashCommandRegistry`** in
`packages/platform/src/slash-commands.ts` (see ADR-0023). The router is
consulted by `createInboundHandler` **before** the harness gate, so a DM's
`/help` on a workspace with a restrictive default profile still gets a
reply — the operator is entitled to a picker regardless of engagement
policy.

Built-in commands, generated from workspace content at platform boot:

| Command | Source |
|---|---|
| `/help`, `/commands` | registry itself (Hermes/openclaw naming parity) |
| `/whoami` | active session + agent |
| `/agents` | `workspace/agents/*.md` |
| `/agent <slug>` | validates against catalog, updates session `agentName` |
| `/skills` | `workspace/skills/*.md` |
| `/souls`, `/soul <slug>` | `workspace/souls/*.md` (via SoulService) |
| `/goals [--status active\|completed\|paused]`, `/goal <slug>` | goal engine |
| `/mcp [list\|health]` | MCP integration registry + bridge |
| `/sessions` | recent sessions from the session store |
| `/channels` | live channel adapter health probe |
| `/automations` | automation/cron engine |
| `/reset` | clears `messages` + `metadata.agentRunCheckpoint` on current session |
| `/drafts`, `/draft <slug>`, `/promote <slug> [--force]`, `/discard <slug>`, `/capture` | learning-loop draft lifecycle (v2.1.1) |
| `/personas`, `/persona <slug>` | `workspace/personas/*.md` |
| `/workflows`, `/workflow <slug>` | `WorkflowRegistry` |
| `/blueprints`, `/blueprint <slug>` | `BlueprintCatalogRegistry` |
| `/kanban` | `KanbanEngine.listBoards()` |
| `/tools` | `ToolGateway.listTools()` |
| `/hooks` | `workspace/hooks/hooks.yaml` |
| `/session <id>` | one session's full status + last three turns |
| `/skill <slug>` | one skill's frontmatter + instructions (2KB cap) |
| `/status`, `/history [n]` | current session status, last N turns |
| `/stop`, `/detach`, `/checkpoint [label]` | session control |
| `/providers`, `/provider <slug>` | list model providers, override for this session (v2.2.0) |
| `/model <id>`, `/runtime <slug>`, `/routing` | per-thread model/runtime override + effective config |
| `/version`, `/settings` | Anvio version + effective session config |
| `/thumbsup`, `/thumbsdown [reason]` | write feedback to `workspace/memory/feedback/` |
| `/audit [--last <n>]` | tail of `workspace/audit/tokens.jsonl` + aggregate (v2.2.1) |
| `/memory <query>` | search filesystem memory scoped to the current user (v2.2.1) |
| `/knowledge [<slug>]` | list bases or entries under one via `KnowledgeBaseStore` (v2.2.1) |
| `/artifacts [--session <id>\|--global]` | recent artifacts from `FilesystemArtifactStore` (v2.2.1) |
| `/harness` | `HarnessDefaults` + effective channel profile for this thread (v2.2.1) |
| `/connections` | connection-broker entries (payloads never printed) (v2.2.1) |
| `/worktree` | git worktrees created for isolated sessions (v2.2.1) |

`SlashCommandRegistry` also exposes `register(command)` so late-bound subsystems (goal engine, automation, workflow executor) can attach commands after the registry has been handed to channel adapters.

### Per-thread runtime / provider / model overrides (v2.2.0)

`/provider deepseek`, `/model deepseek-chat`, `/runtime claude-code` write to `session.metadata.providerOverride` / `modelOverride` / `runtimeOverride`. `RuntimeRoutingAgentRuntime` calls `applySessionOverrides(agent, session)` before dispatch — the overrides fold into the agent's `spec.model` / `spec.runtime.provider` for this session only. Original agent definition is untouched, and thread B does not see thread A's override.

The Telegram adapter also syncs its `setMyCommands` picker from
`registry.list()` at start(), so the native `/` dropdown reflects the
workspace. Discord Application Commands and Slack `slash_commands` sync
is deferred to a follow-up ADR (0024); the underlying router already
handles their inbound `/foo` text.

Unknown slash commands fall through to the model with a leading
zero-width space prepended, so downstream vendors (notably the Claude
Agent SDK) do not treat them as their own CLI directives — this defends
against the empty-reply failure mode from issue #54.

## Related

- ADR: `docs/adr/0008-channel-hub-architecture.md`
- ADR: `docs/adr/0023-workspace-slash-commands.md`
- Runtime: `docs/03-runtime.md`
- Events: `docs/17-event-flows.md`
