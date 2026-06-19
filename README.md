# Anvio — Local-First AI Agent Operating System

Anvio is a **local-first, file-first, CLI-first** AI Agent Operating System. Create and manage intelligent agents via YAML/Markdown — no database, no login, no Docker required for Level 1.

## Philosophy

| Principle | Default |
|-----------|---------|
| Storage | Filesystem (`workspace/`) |
| Authentication | Disabled (optional plugin) |
| Memory | JSON files in `workspace/memory/` |
| Events | In-process (no NATS required) |
| Entry point | **CLI** > API > Web UI |

## Quick Start (Level 1 — Zero Dependencies)

```bash
pnpm install
pnpm build

# Chat immediately — no login, no database
pnpm anvio chat

# Or explicitly
node apps/cli/dist/main.js chat --agent architect
```

Set `ANTHROPIC_API_KEY` for real model responses. Without it, mock mode works for testing.

## Workspace Structure

```
workspace/
  anvio.yaml          # Platform config (auth, storage, memory providers)
  agents/             # Agent definitions (YAML)
  personas/           # Persona profiles (YAML)
  skills/             # Reusable skills (YAML)
  sessions/           # Session state (JSON)
  memory/             # Long-term memory (JSON)
  mcp/                # MCP server bindings (Phase 2)
  workflows/          # Workflow definitions (Phase 3)
```

Backup, git-version, and move the entire `workspace/` folder — no database migration needed.

## CLI Commands

```bash
anvio init [path]           # Create new workspace
anvio agents list           # List agents
anvio chat [--agent NAME]   # Interactive chat (default mode)
```

## Optional: API + Gateway (Level 2+)

```bash
# No auth by default — agents run immediately
ANVIO_WORKSPACE=./workspace pnpm --filter @anvio/api dev
ANVIO_WORKSPACE=./workspace pnpm --filter @anvio/worker dev
ANVIO_WORKSPACE=./workspace pnpm --filter @anvio/gateway dev
```

Enable auth in `workspace/anvio.yaml`:

```yaml
spec:
  auth:
    enabled: true
    provider: oauth2  # only when MCP/external provider requires it
```

## Progressive Enhancement

| Level | Storage | Auth | Events | Use Case |
|-------|---------|------|--------|----------|
| 1 | Filesystem | None | Local | Solo developer, CLI |
| 2 | SQLite | Optional OAuth | Local/NATS | Small team |
| 3 | PostgreSQL + Qdrant | JWT/OAuth | NATS | Multi-user production |
| 4 | K8s | Full RBAC | Distributed | Enterprise scale |

## Configuration

Everything is editable without TypeScript changes:

- **Agents** — `workspace/agents/*.yaml`
- **Personas** — `workspace/personas/*.yaml`
- **Skills** — `workspace/skills/*.yaml`
- **Platform** — `workspace/anvio.yaml`

## Development

```bash
pnpm build
pnpm test
pnpm typecheck
```

## Documentation

See [`docs/`](docs/) — especially [`docs/02-architecture.md`](docs/02-architecture.md) and [`docs/21-development-guide.md`](docs/21-development-guide.md).

## License

MIT — see [LICENSE](LICENSE).
