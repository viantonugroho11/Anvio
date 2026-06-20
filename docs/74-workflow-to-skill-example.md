# Workflow → Skill pattern

Hermes-style pattern: capture a repeatable workflow as a **skill** the agent can invoke.

## When to convert

- DAG/workflow ran successfully ≥2 times with same structure
- Steps are deterministic (gather → transform → report)
- Output is reusable prose or checklist

## Example mapping

| Workflow node | Skill section |
|---------------|----------------|
| `gather-a`, `gather-b` | `## Procedure` steps |
| `merge` output template | `## Output format` |
| Workflow `inputs.topic` | Skill frontmatter `inputs` |

## Files in this repo

| Artifact | Path |
|----------|------|
| Source workflow | [workspace/workflows/example-dag.md](../workspace/workflows/example-dag.md) |
| Derived skill | [workspace/skills/dag-report-skill.md](../workspace/skills/dag-report-skill.md) |

## CLI flow

```bash
# 1. Run workflow
anvio workflow run example-dag topic=architecture

# 2. Agent loads skill on next run
anvio run architect "Use dag-report skill for topic=api-design"

# 3. Promote via learning loop (optional)
anvio learning drafts
anvio learning promote <draft-id>
```

## Authoring checklist

1. Keep workflow `nodes` ≤7 for skill-sized procedures
2. Name skill slug matching workflow slug when 1:1
3. Add `metadata.sourceWorkflow: example-dag` in skill frontmatter
4. Validate: `anvio skill validate dag-report-skill`

See [49-workspace-artifacts.md](./49-workspace-artifacts.md) and [69-post-v1.17-gap-register.md](./69-post-v1.17-gap-register.md) W1.
