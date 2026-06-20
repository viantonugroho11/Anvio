---
apiVersion: anvio.io/v1
kind: Skill
metadata:
  slug: dag-report-skill
  name: DAG Report Skill
  sourceWorkflow: example-dag
spec:
  description: Produces a merged DAG report from parallel gather steps (derived from example-dag workflow)
  triggers:
    - dag report
    - parallel gather
---

# DAG Report Skill

Derived from workflow `example-dag`. Use when the user wants a structured report from two parallel research branches.

## Procedure

1. Gather finding A for the given topic (web search or repo scan).
2. Gather finding B from a complementary angle.
3. Merge into markdown:

```markdown
# DAG Report — {topic}
- {finding-a}
- {finding-b}
```

## Output format

- Title: `# DAG Report — {topic}`
- Two bullet findings, no filler
- Link sources when available

## Example

Input topic: `monorepo`

Output:

```markdown
# DAG Report — monorepo
- Turborepo caches task graphs per package; shared tsconfig reduces drift.
- pnpm workspaces isolate deps; CI runs `turbo run build test` in parallel.
```
