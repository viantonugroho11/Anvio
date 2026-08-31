# ADR-0023: Workspace-scoped slash commands, cross-channel

- **Status:** Accepted
- **Date:** 2026-08-31
- **Related:** #53 (Telegram `setMyCommands` gap), #55 (this — cross-channel router), #56 (skill promotion surface), ADR-0008 (Channel Hub)

## Context

v2.0.2 shipped a Telegram-only slash-command dispatcher. It solved the immediate discovery problem (the client's `/` picker was empty) but two of the commands users care about most — `/agents` and `/skills` — landed as stubs, `/reset` was a no-op acknowledgement, and `/agent <slug>` was absent entirely. The dispatcher also lived inside `TelegramChannel` where nothing else could reach it, so the same set of commands would need to be re-implemented per adapter (Discord Application Commands, Slack `slash_commands`, Mattermost `/slash`, and eventually the plain-text `/foo` path that WhatsApp / SMS / Email / REST / CLI share).

The natural home for the router is the platform, not any single adapter. `workspace/agents/*.md` and `workspace/skills/*.md` are the source of truth for what the bot can do; the picker on every channel should reflect that catalog, and every adapter should share one dispatcher.

The learning loop (#56) has its own slash-command needs — `/drafts`, `/promote`, `/discard`, `/capture` — that only make sense once the router is a first-class thing.

## Decision

Introduce a **`SlashCommandRegistry`** port in `@anvio/core` and a platform-side factory that composes it from workspace content plus built-ins. Every channel adapter routes slash-prefixed messages through the registry **before** the harness gate.

### Shape

```ts
// packages/core/src/ports/slash-command.port.ts
export interface SlashCommand {
  name: string;                    // 'agents', 'skill', 'reset', …
  description: string;             // ≤ 100 chars, shown in Telegram/Discord picker
  scope?: 'global' | 'dm' | 'group';
  handler: (ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

export interface SlashCommandContext {
  channel: string;                 // ChannelType
  sessionId: string;
  userId: string;
  threadId: string;
  isDm: boolean;
  argsRaw: string;                 // everything after the first token
  argsList: string[];              // whitespace-split
}

export interface SlashCommandResult {
  reply?: string;                  // plain-text reply, adapter formats
  swallow: boolean;                // if true, do NOT forward to the model
  updateSession?: Partial<{ agentName: string; reset: boolean }>;
}

export interface SlashCommandRegistry {
  list(): SlashCommand[];          // for picker sync
  dispatch(input: string, ctx: SlashCommandContext): Promise<SlashCommandResult | null>;
}
```

### Registration order

1. **Built-ins** (platform): `/help`, `/whoami`, `/reset`, `/agents`, `/agent <slug>`, `/skills`, `/skill <slug> [args]`, plus learning-loop: `/drafts`, `/draft <slug>`, `/promote <slug>`, `/discard <slug>`, `/capture`.
2. **Workspace overrides** (deferred to a follow-up): `workspace/commands/*.md` — user-defined commands bound to a skill.

### Dispatch flow

```
InboundMessage → createInboundHandler
  ├── if content.startsWith('/'):
  │     result = await registry.dispatch(content, ctx)
  │     if result?.swallow: send reply via channelHub.sendMessage, return
  │     (unhandled slash falls through — escaped to prevent SDK slash-command match)
  ├── harness.handleInbound(...)
  └── publish AGENT_RUN_REQUESTED
```

Slash commands run **before** the harness gate deliberately. A DM to a private bot that says `/help` should not be silenced by a `restricted_zone` decision — the operator is entitled to a picker regardless of engagement policy.

### Adapter integration

Each adapter that has a native command primitive syncs its picker from `registry.list()` at boot:

- **Telegram** — `setMyCommands` (implemented in v2.1.0).
- **Discord** — Application Commands (`PUT /applications/{app.id}/commands`), follow-up.
- **Slack** — `slash_commands` manifest, follow-up.
- **Mattermost** — `POST /commands`, follow-up.
- **WhatsApp / SMS / Email / Web-chat / REST / CLI** — no picker, but the same `/foo` text hits `createInboundHandler` and is routed the same way. No adapter work needed.

Follow-up ADR-0024 will record the per-adapter picker sync when the Discord/Slack/Mattermost work lands.

## Consequences

- **Positive:**
  - One registry: adding a command wires it up everywhere at once.
  - The learning-loop chat surface (#56) is a set of registered commands, not adapter-specific glue.
  - `/agent <slug>` and `/reset` become real behavior — session `agentName` is updated in the session store, `reset` clears `messages` + `metadata.agentRunCheckpoint`.
  - Silent-drop shape from #52 does not extend to slash commands: a DM's `/help` is never subject to `restricted_zone`.

- **Costs:**
  - `createInboundHandler` in `packages/channels/src/create-channels.ts` gains an optional dependency on the registry.
  - `PlatformContext` gains one more field. Backward-compatible via `options.startChannels`.
  - Discord/Slack picker sync deferred; only Telegram's picker is generated from the registry in v2.1.0. This is deliberate — the shape is proven end-to-end with one adapter before the API stabilizes.

## Alternatives considered

1. **Per-adapter dispatchers, no shared registry** (status quo). Rejected: forces the same command set to be re-implemented per adapter and the same skill to be described in three places.
2. **A workspace `commands/` folder that _replaces_ built-ins.** Rejected for v2.1.0: adds a new authoring surface before there is a proven need for it. The `workspace/skills/` -driven `/skill <slug>` route already covers "invoke workspace-defined behavior."
3. **Route slash commands _after_ the harness gate.** Rejected: `/help` deserving of `restricted_zone` is a worse UX than "the operator asks the bot who it is and hears nothing."
