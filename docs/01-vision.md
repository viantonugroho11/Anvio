# Vision

Anvio is a **local-first, file-first, CLI-first** AI Agent Operating System.

## Core Principles

1. **Configuration Driven** — YAML/JSON/Markdown, no TypeScript changes
2. **Local First** — works offline, no mandatory cloud services
3. **File First** — filesystem default storage, human-readable configs
4. **CLI First** — priority: CLI > API > Web UI
5. **Progressive Enhancement** — start simple, grow without rewrites
6. **Optional Auth** — disabled by default; enabled only when needed
7. **Plugin Architecture** — storage, memory, auth, MCP as plugins
8. **Workspace Portable** — backup, git, move without DB migration

## Non-Goals

- Mandatory login or user registration
- Mandatory PostgreSQL or Docker for basic usage
- Enterprise SaaS assumptions
- Copying Hermes or coupling to Slack

## Default Mode (Level 1)

| Component | Default |
|-----------|---------|
| Auth | Disabled |
| Storage | Filesystem (`workspace/`) |
| Memory | JSON files |
| Events | In-process |
| Entry | CLI (`anvio chat`) |

Agents run **immediately after install** — no setup wizard, no OAuth.
