# ADR 0035: gbrain Episodic Timeline and Learning-Loop Consolidation

## Status

Proposed — builds on the `gbrain` memory provider from PR #88 (`feat/gbrain-memory-provider`).

## Context

PR #88 adds `memory.provider: gbrain`: sessions stay on the filesystem delegate and only durable `fact` / `preference` / `summary` entries sync to gbrain through the MEMORY_VERBS v1 MCP surface (`remember`, `recall`, `forget`). Raw conversation turns are deliberately not sent.

slaude goes further (`src/memory/brain-provider.ts`, `src/knowledge/brain.ts`):

- gbrain is embedded in-process (pinned commit), with a **per-agent source** so agents do not read each other's episodic memory.
- Each session gets a **conversation page**; turns are appended as **timeline rows** (no page rewrite, no version bloat).
- A **nightly cycle** mines those pages into facts.
- Failure policy: memory never breaks a turn; prefetch degrades to null, sync to a logged no-op.

Anvio already has the consolidation half: `packages/learning` (`SessionSummarizer`, memory nudges, skill drafts) runs on session end, and `packages/automation` runs cron jobs.

## Decision

1. **Stay on MCP.** Do not embed gbrain in-process. gbrain ships Bun-oriented TypeScript sources; importing them would couple Anvio's Node build to one gbrain commit. Use `gbrain serve` with the **full** surface (not only `--surface verbs`) when episodic memory is enabled, because timeline writes need page/timeline operations beyond the seven verbs.
2. **Episodic timeline.** Add `memory.gbrain.episodic: true`. When set, `GbrainMemoryProvider.storeConversation` ensures one page per session (slug `anvio/<agent>/sessions/<sessionId>`) and appends each new turn as a timeline entry (short summary + truncated detail). Writes are best-effort, as in PR #88.
3. **Per-agent scoping.** Each Anvio agent maps to its own gbrain source (`anvio-<agentId>`); facts promoted to shared knowledge are written to a shared source explicitly. Requires the gbrain client to carry the agent id, so the platform creates one client binding per agent rather than one per process.
4. **Consolidation through `learning`, scheduled by `automation`.** A `gbrain-consolidate` job (default nightly) reads recent session timelines, runs `SessionSummarizer`, and writes results back via `remember` with `provenance` pointing at the session page. Soul gating still applies: promotion to long-lived facts follows the soul's `evolution.allowAutoUpdate`.
5. **Never break a turn.** Timeline and consolidation failures are logged and reported in `healthCheck`; they never throw into the agent loop.

## Consequences

- Anvio gains slaude-style episodic memory without a Bun or gbrain build dependency.
- More data leaves the filesystem: full turn summaries go into the brain. Default stays `episodic: false`; docs must state that gbrain's default `visibility: world` exposes them to every client of the same brain.
- PGLite concurrency limits (one writer) make the nightly job and the live gateway contend; the job must reuse the gateway's client or the deployment must use `gbrain serve --http` / Postgres.
- Depends on gbrain's non-frozen full operation surface; the MEMORY_VERBS freeze only covers the seven verbs, so timeline calls need a compatibility check on gbrain upgrades.

## Alternatives considered

- **Embed gbrain like slaude.** Rejected for now (build coupling above); revisit if gbrain publishes a stable Node-compatible package.
- **Store transcripts only on the filesystem and send summaries.** That is PR #88's behaviour; kept as the default, with timelines as opt-in.
