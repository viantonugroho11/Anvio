# ADR-0025: Mutation surface (`/new`, `/edit`, `/rm`), session forking, batch/worktree/connections/setup-token

- **Status:** Accepted (partial, v2.3.0 track 1 shipped) — session forking (`/branch`, `/resume`, `/history --branch`) and the `_trash/` foundation (`anvio trash list|rm|restore|prune`) are implemented. The uniform mutation surface (`/new`, `/edit`, `/rm`), `/batch` chat handlers, `/setup-token` QR, `/providers add|remove|test`, `/worktree new|rm`, and `/connections revoke` remain queued for v2.3.0 track 2.
- **Date:** 2026-09-01
- **Related:** #57, ADR-0024 (deferred these), ADR-0023 (router shape), ADR-0019 (credential broker), ADR-0009 (runtime OAuth)

## Context

ADR-0024 shipped the discovery, session-control, and per-thread override surface. It deferred four categories:

1. Uniform **mutation** — `/new`, `/edit`, `/rm` for every workspace primitive.
2. **Session forking** — `/resume`, `/branch <label>` with `parent_session_id` chain.
3. **Batch / worktree / connections / setup-token** — each needs a chat-native UX (streaming status, QR + polling) that a router expansion doesn't provide.
4. **`/providers add|remove|test`** — mutation-shape write to `providers/routing.yaml`, gated by the same approver flow as (1).

v2.2.1 also ships the last read-shaped commands ADR-0024 queued (`/audit`, `/memory`, `/knowledge`, `/artifacts`, `/harness`, `/connections`, `/worktree`). This ADR designs the remaining categories so v2.3.0 can implement them without redoing the design.

## Decision

### Mutation surface (v2.3.0)

Uniform verbs across every primitive: `/new <primitive>`, `/edit <primitive> <slug>`, `/rm <primitive> <slug>`. Primitives: `agent`, `persona`, `soul`, `skill`, `workflow`, `goal`, `blueprint`, `automation`, `hook`, `mcp`, `knowledge`.

**Approver gate.** Every mutation is a `harness.recordApproval()` round-trip. The inline button carries `{action: 'new'|'edit'|'rm', primitive, slug, diff}`. Reuse the same flow that already gates tool calls in `packages/harness/src/approval-gate.ts` — no new consent surface.

**Soft delete.** `/rm` never `fs.unlink`s. It moves the file to `workspace/_trash/<primitive>/<slug>-<UTC-timestamp>` and prints the restore command:
  `anvio <primitive> restore <slug>-<timestamp>`
The trash is workspace-local; `anvio learning drafts prune` gets a sibling `anvio trash prune`.

**`/edit` UX.** Two-turn flow:
- Turn 1: adapter posts the current YAML/MD as a code block, sets `session.metadata.pendingEdit = { primitive, slug, hash }` and switches the effective agent to a specialist (`documenter` for prose, `tech-lead` for structure).
- Turn 2: user's next text is prompted at the specialist with the current file + the edit request; the response is diffed against the file, and the diff is what the approver sees.
- Turn 3: approver click applies the diff (or discards; the pending state clears on either).

**`/new` UX.** One-turn: `/new agent <slug>` scaffolds the file from a template + posts it back. The user runs `/edit agent <slug>` if they want to change it before the first run.

**Rollback.** Every mutation writes to `workspace/audit/mutations.jsonl` with `{ts, actor, primitive, slug, action, hash_before, hash_after, approvalId}` — the same audit format token usage uses today.

### Session forking (v2.3.0)

**`parent_session_id` chain** — new optional field on `StoredSession`. `session.create()` accepts `parentSessionId`; the child's `messages` is seeded from the parent's `messages` up to (and including) the checkpoint `session.metadata.agentRunCheckpoint`.

**`/branch <label>`** — creates a child session in the same thread, tagged `label`. The child inherits the parent's agent, provider/model/runtime overrides, and metadata (except `agentRunCheckpoint`, which is cleared so the child starts fresh from the checkpoint's message tail).

**`/resume`** — reopens the last session in this `(channel, threadId)` whose `status ∈ {failed, stopped}`. If a checkpoint exists, resumes from the checkpoint; otherwise re-runs the last user message. Emits `AGENT_RUN_REQUESTED` with the resumed session id.

**`/history --branch`** — introspection: show the branch tree rooted at this session.

### Batch (v2.3.0)

`/batch list` — active + recently-completed jobs from `workspace/batch/_state/*.json`.
`/batch status <id>` — one job's progress + last N log lines.
`/batch stop <id>` — publish `BATCH_STOP_REQUESTED` (a follow-up event beside `AGENT_RUN_STOP_REQUESTED`).
`/batch <workflow.yaml>` — enqueue; approver-gated because it consumes tokens.

Wiring: `packages/batch` already has an engine; the CLI surfaces it. The chat handlers wrap `BatchEngine.list/get/stop/enqueue`.

### Worktree (v2.3.0)

`/worktree list` shipped in v2.2.1. The mutations are:
- `/worktree new <sessionId>` — approver-gated `create()`.
- `/worktree rm <sessionId>` — approver-gated `remove()` (worktrees on disk are already deletable — no `_trash/` shuffle here).

### Connections (v2.3.0)

`/connections` shipped in v2.2.1 (read-only, payloads never printed). Mutations:
- `/connections revoke <channel> <userId> <service>` — approver-gated `broker.revokeConnection()`.
- `/connections grant` — deferred; grants are still CLI-only because they involve pasting a payload and we do not want that in chat.

### Setup-token (v2.3.0)

`/setup-token <vendor>` starts `startLoginHost`, returns:
- On desktop bots: the browser URL (short).
- On remote/headless deploys: a URL + QR (as an image attachment via the channel adapter's `sendAttachment` when available; otherwise a text QR built with `qrcode-terminal`).

The adapter polls `startLoginHost.result()` and posts a `Setup complete` message once the OAuth flow returns, or `Setup timed out (5m)` on expiry.

### `/providers add|remove|test` (v2.3.0)

Same shape as `/new` / `/rm` for the provider row inside `workspace/providers/routing.yaml`. `/providers test <slug> "prompt"` runs a probe via `ModelRouter.probeProvider(slug, prompt)` — a new helper — and reports latency + cost estimate. Approver-gated for `add` / `remove` (no gate on `test`, since it's a probe with an operator's key).

## Consequences

- **Positive:** Every workspace primitive becomes reachable from chat for read, mutation, and lifecycle control. `/edit` is the missing piece for a chat-only operator flow. `/branch` + `/resume` unlock experiment-and-back-out patterns that today force a new agent + config file for each variation.
- **Cost:** `parent_session_id` is a schema change on `StoredSession`. Backward-compatible (optional field) but every session store implementation (`filesystem`, `sqlite`, `postgresql`) needs to plumb it. Mutation adds a `workspace/audit/mutations.jsonl` and a `workspace/_trash/` — two new well-known paths.
- **Deferred:** `/connections grant` (payload-in-chat is a security question that deserves its own thought), and the specialist-agent-scoped `/edit` might grow into ADR-0026 if the two-turn flow turns out to need more state.

## Alternatives considered

1. **Immediate mutation without approver.** Rejected — the surface reaches the whole workspace, and the harness already has the approval flow. Skipping it would be a hole that a compromised chat account walks through.
2. **`git`-backed mutation instead of `_trash/`.** Considered but rejected for v2.3.0 — many workspaces aren't git repos, and requiring one would break the local-first tier. `_trash/` is universal; a follow-up can add a `git`-hook when a repo is present.
3. **`/edit` as one turn (edit prompt + file supplied together).** Rejected — the review step is what makes it safe, and splitting into two turns puts the diff in the approver's view rather than the user's memory.
