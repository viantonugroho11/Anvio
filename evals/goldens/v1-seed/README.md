# v1-seed goldens

Golden trajectory captures from Anvio v1 sessions. Story [P1.S6](../../../docs/engineering-backlog-vnext.md) — used to gate future refactors (Model Gateway shim, memory engine swap, tool bus rewrite) against behavioral regressions.

## Contents

- `<sessionId>.json` — one `TrajectoryExport` per session, produced by `exportSessionTrajectory` in `packages/platform/src/trajectory-export.ts`.
- `index.json` — flat list `{ id, agent, channel, messages, tag }` for filtering.

## Target coverage (~50 sessions)

| Tag | Description | Target count |
|-----|-------------|--------------|
| `chat` | Plain conversational, no tool use | 10 |
| `tool-heavy` | ≥3 tool calls per session | 15 |
| `approval` | Includes at least one soul-gated approval | 10 |
| `multi-turn` | ≥8 user turns | 10 |
| `multi-agent` | `delegate_task` / supervisor pattern | 5 |

## Capture workflow

```bash
# From repo root. ANVIO_WORKSPACE points at a live workspace with sessions/.
# Script lives in apps/cli/scripts/ so it can resolve @anvio/* workspace deps.
ANVIO_WORKSPACE=./workspace pnpm --filter @anvio/cli exec \
  tsx scripts/capture-goldens.ts \
  --min-messages 4 \
  --limit 50 \
  --tag chat
```

Re-run per tag. Script is idempotent (skips existing files unless `--force`).

## Review before commit

1. Diff `index.json` — confirm tag distribution matches target.
2. Spot-check ≥5 files for PII, credentials, or internal URLs. Redact or drop.
3. Confirm no file exceeds 200 KB (indicates unbounded tool output — file a bug).
4. Commit with message `test(evals): capture v1-seed goldens (<tag>, N=<count>)`.

## Replay

Replay tooling ships in a follow-up story (P1.S6 acceptance is capture only). Interim contract: any change that mutates `TrajectoryEntry.role` or `content` semantics must include a migration note in `CHANGELOG.md` and a golden diff explanation.
