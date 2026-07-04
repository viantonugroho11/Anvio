# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                     # install deps (Node 20+, pnpm 9+)
pnpm build                       # turbo build all packages/apps (dependency-ordered)
pnpm dev                         # turbo dev --parallel (all apps in watch mode)
pnpm typecheck                   # turbo typecheck (needs build of deps first)
pnpm lint                        # turbo lint
pnpm format / pnpm format:check  # prettier over ts/tsx/js/json/md/yml

pnpm test                        # vitest run, whole repo (root vitest.config.mts)
pnpm test:integration            # tests/integration/*.integration.spec.ts only (requires build)
pnpm --filter @anvio/core test   # run one package's test script directly
vitest run packages/core/src/token-usage.spec.ts   # single file, from repo root

pnpm --filter @anvio/db db:generate|db:migrate|db:seed   # Drizzle (PostgreSQL, Level 3+ only)

pnpm cli <args>                  # tsx apps/cli/src/main.ts (dev, no build needed)
pnpm anvio <args>                # node apps/cli/dist/main.js (needs `pnpm build` first)
```

Unit tests are colocated as `*.spec.ts` next to source (e.g. `packages/core/src/token-usage.spec.ts`). Integration tests live only in `tests/integration/*.integration.spec.ts`. Turbo's `test` task depends on `^build`, so a package's compiled `dist/` of its dependencies must exist before its tests run — after touching a package other packages depend on, `pnpm build` before testing.

There is no repo `workspace/` used for building/testing the code itself — `./workspace` (gitignored contents like `sessions/`, `state.db`, `connections/`) is *runtime data* for whatever agent workspace you point `ANVIO_WORKSPACE` at, not build output.

## Architecture

Anvio is a pnpm/turbo monorepo implementing a **local-first AI agent operating system**: agents are configured in Markdown (frontmatter + persona body), infra in YAML, and the whole thing runs from a CLI without requiring a database or Docker at the default tier.

### Dependency rule

```
apps → platform → packages → core
```

`packages/core` has no internal deps (schemas, ports, zod types only). `packages/platform` is the composition root that wires everything from `workspace/anvio.yaml` into a running system — apps never assemble subsystems themselves, they call into `platform`. Domain logic lives in `packages/*`, never in `apps/api`'s NestJS controllers or CLI command handlers directly.

### Apps (`apps/`)

- `cli` — primary entry point; the platform is fully operable from here alone (`anvio chat`, `anvio run`, etc.)
- `api` — optional NestJS REST layer
- `worker` — background job consumer for detached/`--detach` runs
- `gateway` — WebSocket + unified daemon (`anvio gateway start` bundles channel hub + worker + API + WS in one process)
- `web` — Next.js 15 + Tailwind 4 dashboard, reads from the API's `/api/overview`, `/api/tools`, `/api/sessions` endpoints
- `desktop` — desktop shell scaffold (early stage)

### Packages (`packages/`) — grouped by role

- **Foundation**: `core` (schemas/ports), `workspace` (loader + session store), `storage` (pluggable, filesystem default), `auth` (optional plugin, off by default)
- **Runtime engine**: `agents` (multi-turn tool-loop orchestration), `models` (18 provider routing/fallback), `runtimes` (execution backends: local, claude-code, cursor, codex, antigravity, ssh, daytona, modal, singularity), `tools` (73 built-in tool gateway), `memory` (FTS5, Honcho delegate)
- **Advanced Agent OS**: `souls` (long-lived identity + soul-gated self-evolution), `soul-gate`, `goals`, `automation` (cron/hooks), `blueprints`, `kanban`, `batch`, `workflows` (DAGs), `execution` (sandboxed code exec), `credentials` (encrypted key pools), `skills` (catalog + learning-loop drafts), `learning` (skill evolution, memory nudges, session summaries)
- **Connectivity**: `channels` (14 chat/voice adapters), `harness` (channel formatting/engagement/approval), `integrations` (MCP-first registry), `acp` (Cursor/editor integration), `voice` (STT/TTS), `knowledge` (raw → wiki ingest), `personas`, `events` (in-process bus + optional NATS), `hooks`, `observability`, `db` (Drizzle/PostgreSQL, Level 3+)

### Two distinct auth layers — do not conflate

1. **Model API key** (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, …) — powers the `local` runtime's direct SDK/HTTP tool loop.
2. **Runtime OAuth** (`anvio setup-token --claude|--cursor|--codex|--antigravity`) — powers vendor-CLI runtimes (Claude Code Agent SDK, Cursor, Codex, Antigravity), stored encrypted under `workspace/connections/`.

Never set `ANTHROPIC_API_KEY` in the same environment as `runtime.provider: claude-code` — the env var shadows OAuth and silently bills API credits instead of the subscription. This distinction is load-bearing throughout `packages/runtimes` and `packages/models`; when adding a provider/runtime, get this right rather than defaulting to "just add an env var."

### Agent definition & tool loop

Agents are `workspace/agents/*.md` (frontmatter: `persona`, `skills`, `model`, `runtime`, `soul`; body: system prompt). `packages/agents` runs the multi-turn loop: prompt → model → optional `anvio_tool` fenced-block or native `tool_use` call → `packages/tools` executes → up to 5 round-trips → learning loop fires on session end (memory nudge, LLM summary, skill draft via `packages/learning`, gated by the soul's `evolution.allowAutoUpdate`).

### Progressive storage/infra tiers

Level 1 (default): filesystem sessions (`workspace/sessions/*.jsonl`), no auth, in-process events, no Docker. Level 2: flip `storage.provider: sqlite` in `anvio.yaml` for `state.db` + FTS5 search. Level 3+: PostgreSQL + Qdrant + NATS JetStream + JWT (`packages/db`, `docker/docker-compose.dev.yml`). Don't introduce a Level 3+ dependency into code paths meant to work at Level 1.

Further detail: `docs/02-architecture.md`, `docs/24-advanced-agent-os-overview.md`, `docs/adr/0009-runtime-oauth-authentication.md`.
