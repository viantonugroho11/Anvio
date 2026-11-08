# CLI reference

The `anvio` CLI (`apps/cli`) is the primary entry point; the platform is fully operable from it alone. This page mirrors `anvio --help`. Run `anvio <command> --help` for the flags of one command.

| How you installed                           | Invoke as           |
| ------------------------------------------- | ------------------- |
| Repository clone, after `pnpm build`        | `pnpm anvio <args>` |
| Repository clone, no build (dev, via `tsx`) | `pnpm cli <args>`   |
| Install script (`scripts/install.sh`)       | `anvio <args>`      |

## Core

| Command                                                                       | Purpose                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `anvio init [path]`                                                           | Create a workspace scaffold (no agents or personas yet) |
| `anvio workspace validate`                                                    | Validate workspace structure and config                 |
| `anvio agents list`                                                           | List configured agents                                  |
| `anvio chat [--agent NAME]`                                                   | Interactive chat session                                |
| `anvio run <agent> [message]`                                                 | Run one task; `--detach` runs it in the background      |
| `anvio sessions list` · `anvio status [sessionId]` · `anvio logs <sessionId>` | Inspect sessions                                        |
| `anvio session 1on1 [--agent NAME]`                                           | Dedicated 1-on-1 CLI session                            |
| `anvio session export <id> [--md]`                                            | Export a session trajectory                             |
| `anvio approve <session> <id>`                                                | Approve a pending tool request                          |
| `anvio stop <sessionId>`                                                      | Stop a running session                                  |
| `anvio inbox <sessionId> <msg>`                                               | Inject an instruction into a running agent              |
| `anvio worktree list\|create\|remove`                                         | Git worktree isolation per session                      |
| `anvio trash list\|rm\|restore\|prune`                                        | Workspace soft-delete and restore                       |

## Gateway and channels

| Command                                              | Purpose                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `anvio gateway start\|stop\|status`                  | Unified daemon: channel hub + worker + HTTP API + WebSocket (`--foreground` to stay attached) |
| `anvio channels status [--json]`                     | Channel adapter health                                                                        |
| `anvio harness status\|simulate`                     | Channel harness; `simulate --scenario <file...>` runs end-to-end scenarios                    |
| `anvio connect list\|put\|revoke\|login-host\|login` | Contextual connections broker                                                                 |

## Models, runtimes, credentials

| Command                                                                | Purpose                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `anvio setup-token --claude\|--cursor\|--codex\|--antigravity\|--nous` | OAuth login for vendor runtimes                                       |
| `anvio runtime list\|test`                                             | Runtime providers (local, claude-code, cursor, codex, ssh, docker, …) |
| `anvio routing show\|providers\|catalog\|test`                         | Provider routing and fallback                                         |
| `anvio credentials list\|add\|test`                                    | Encrypted credential pools                                            |
| `anvio usage stats [--json] [--last 24h]`                              | Token usage from the audit ledger                                     |
| `anvio exec run\|audit`                                                | Sandboxed code execution                                              |
| `anvio acp serve\|status`                                              | ACP editor bridge                                                     |

## Tools, MCP, skills, knowledge

| Command                                                                 | Purpose                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `anvio tools list\|test`                                                | Built-in tool gateway — see [catalog](./builtin-tools.md) |
| `anvio mcp list\|test\|health\|preset`                                  | MCP servers — see [MCP reference](./mcp.md)               |
| `anvio skill catalog\|install\|import\|validate\|upgrade\|test`         | Skills                                                    |
| `anvio learning drafts\|promote\|summarize-sessions\|consolidate`       | Learning loop output                                      |
| `anvio kb list\|ingest\|sync\|import-manifest`                          | Knowledge base pipeline                                   |
| `anvio voice transcribe\|stream-transcribe\|realtime-transcribe\|speak` | Speech in and out                                         |

## Identity, planning, automation

| Command                                                      | Purpose                           |
| ------------------------------------------------------------ | --------------------------------- |
| `anvio soul list\|show\|create\|import\|validate-policy`     | Souls and the SOUL.md policy gate |
| `anvio goal list\|create\|progress\|complete\|pause\|resume` | Goals                             |
| `anvio kanban list\|create\|move`                            | Kanban tasks                      |
| `anvio planner phases\|run <task>`                           | PLAN → EXECUTE → REVIEW           |
| `anvio automation list\|run\|enable`                         | Event and scheduled automations   |
| `anvio cron list\|next-runs`                                 | Cron utilities                    |
| `anvio hooks test <event>`                                   | Test event hook handlers          |
| `anvio batch run\|status\|resume`                            | Parallel batch jobs               |
| `anvio workflow list\|validate\|run`                         | DAG workflows                     |
| `anvio blueprint catalog\|run`                               | Workflow blueprints               |
