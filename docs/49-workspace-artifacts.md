# Workspace Artifacts — MD-first (Phase J)

Anvio aligns with [Hermes Agent](https://hermes-agent.nousresearch.com/docs) and [slaude](https://github.com/barockok/slaude) conventions: **human artifacts are Markdown**, not heavy Kubernetes-style YAML.

## What uses Markdown

| Artifact | Path | Format |
|----------|------|--------|
| **Soul** | `souls/<slug>/SOUL.md` | Hermes sections (Identity, Values, …) |
| **Skill** | `skills/<slug>.md` or `skills/<slug>/SKILL.md` | [agentskills.io](https://agentskills.io) frontmatter + body |
| **Agent** | `agents/<name>.md` | YAML frontmatter + markdown description |
| **Workflow** | `workflows/<slug>.md` | YAML frontmatter (DAG spec) + prose docs |

## What stays YAML

Infrastructure and machine config — not author-facing prose:

- `anvio.yaml` — workspace settings
- `harness/`, `tools/gateway.yaml`, `providers/routing.yaml`
- `automations/`, `blueprints/` (orchestration wiring)
- `hooks/hooks.yaml`, `mcp/servers.yaml`

This matches [hermes-tech](https://github.com/viantonugroho11/hermes-tech): skills and SOUL are `.md`; planner/automation config stays structured.

## Examples

```bash
workspace/
  agents/architect.md
  skills/architecture.md
  souls/architect-soul/SOUL.md
  workflows/example-dag.md
  blueprints/architecture-review.yaml   # wiring only
```

## Loader precedence

For each artifact type, Anvio tries **`.md` first**, then legacy `.yaml` — so existing YAML workspaces keep working during migration.

## Learning loop drafts

Skill evolution writes `skills/_drafts/*.md`, promoted to `skills/*.md`.
