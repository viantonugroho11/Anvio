// Cross-channel slash-command router — see ADR-0023.
//
// The Telegram-only dispatcher in v2.0.2 solved discovery but left three of
// the commands users actually need as stubs (`/agents`, `/skills`, `/reset`
// as a no-op) and lived inside the adapter where Discord/Slack/Mattermost
// could not share it. This port makes the router a first-class thing the
// platform composes from workspace content and every adapter consults.

export type SlashCommandScope = 'global' | 'dm' | 'group';

export interface SlashCommandContext {
  channel: string;
  sessionId: string;
  userId: string;
  threadId: string;
  isDm: boolean;
  /** Everything after the first token, verbatim. */
  argsRaw: string;
  /** Whitespace-split arg list, empty when none. */
  argsList: string[];
}

export interface SlashCommandResult {
  /**
   * Text to send back on the same channel. Adapters may format markdown
   * as their native syntax; the router does not.
   */
  reply?: string;
  /**
   * When true, the inbound is fully handled — the router's caller must
   * NOT forward the content to the model. When false, the reply (if any)
   * is still sent, but the message also flows to the harness gate.
   */
  swallow: boolean;
  /**
   * Session-state changes applied by the router's caller so per-adapter
   * update paths stay in one place. `reset: true` clears messages and
   * `metadata.agentRunCheckpoint` on the current session.
   */
  updateSession?: Partial<{ agentName: string; reset: boolean }>;
}

export interface SlashCommand {
  name: string;
  description: string;
  scope?: SlashCommandScope;
  handler: (ctx: SlashCommandContext) => Promise<SlashCommandResult>;
}

export interface SlashCommandRegistry {
  list(): SlashCommand[];
  /**
   * `input` is the raw message text starting with `/`. Returns null when
   * the first token is not a registered command — the caller then
   * decides how to handle the fall-through (typically: escape the slash
   * so downstream SDKs do not treat it as a CLI command, then forward).
   */
  dispatch(input: string, ctx: SlashCommandContext): Promise<SlashCommandResult | null>;
}
