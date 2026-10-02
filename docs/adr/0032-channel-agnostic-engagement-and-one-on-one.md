# ADR 0032: Channel-Agnostic Engagement State and `/1on1` Thread Lock

## Status

Proposed

## Context

A gap analysis against [slaude](https://github.com/barockok/slaude) (Slack-native Claude Code runtime, v0.44.0) found that its engagement model is its strongest product surface: `@mention` engages a thread, mentioning someone else disengages it, DMs are always engaged, and `/1on1` locks a thread to one human so other participants cannot steer the agent. All of it is enforced in the gateway and persisted (`src/db/one-on-one.ts`, `mention-only.ts`, `ignores.ts`), so it survives restarts and scale-out.

Anvio already has the rule core, but not the durability or the lock:

- `packages/harness/src/engagement.ts` implements `engageOn: mention|always` and `disengageOn: mention_other` per `HarnessChannelProfile`. This is already channel-agnostic.
- The only `EngagementStore` is `MemoryEngagementStore`. A gateway restart forgets every engaged thread, and two gateway processes disagree.
- There is no `/1on1` (or equivalent) owner lock in any channel.
- Slack-specific engagement behaviour lives partly in `packages/channels/src/slack.ts` (266 lines), so other channels cannot reuse it.

## Decision

Keep engagement in `packages/harness` (never in channel adapters or the model) and extend it in three ways:

1. **Persistent store.** Add `FilesystemEngagementStore` (Level 1, `workspace/harness/engagement/*.json`) and a SQLite-backed store when `storage.provider: sqlite` (Level 2). `MemoryEngagementStore` stays for tests and simulation. The platform selects the store from `anvio.yaml`; the gateway never constructs one itself.
2. **Owner lock.** Extend `EngagementState` with an optional `owner: { userId, since }`. When set, `resolveEngagement` only engages for inbound messages from that `userId` (mentions from others are ignored, not treated as `mention_other`). The lock is set and cleared by harness-level slash commands `/1on1` and `/1on1 off`, registered through the existing workspace slash-command surface (ADR 0023/0024), so every channel that supports commands gets it.
3. **Channel adapters report facts, not decisions.** Adapters populate `mentionedBot`, `mentionedOther`, `isDirect` and `senderId` on the inbound envelope; only the harness decides. Slack-specific logic in `slack.ts` that decides engagement moves into the harness.

DMs keep `engageOn: always` via the channel profile; no special-casing in code.

## Consequences

- Engagement survives restarts at Level 1 without adding a database.
- `/1on1` works for every channel with user ids and slash-command support (Slack, Discord, Teams, Mattermost, Telegram); channels without stable user ids (SMS, email) reject it with an explicit message.
- Multi-process gateways still need a shared store; the SQLite store covers a single host, and a Postgres store is deferred to the scale-out work (Level 3).
- Owner ids are matched against the raw envelope sender, never model output, consistent with the soul-gate trust boundary (`verifyPolicyIds`).

## Alternatives considered

- **Copy slaude's Slack-only implementation into `packages/channels/src/slack.ts`.** Rejected: duplicates logic per channel and violates "domain logic in packages, adapters stay thin".
- **Let the model decide engagement from the persona prompt.** Rejected: unenforceable, and the same reason Anvio moved approval decisions into the harness (PRs #80–#84).
