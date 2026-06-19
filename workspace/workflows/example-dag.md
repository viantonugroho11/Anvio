---
apiVersion: anvio.io/v1
kind: Workflow
metadata:
  slug: example-dag
  version: "1.0.0"
  catalog: private
spec:
  description: Demonstrates dependsOn DAG with parallel branches
  inputs:
    topic:
      type: string
      default: architecture
  nodes:
    - id: gather-a
      type: transform
      template: "Finding A for {{inputs.topic}}"
    - id: gather-b
      type: transform
      template: "Finding B for {{inputs.topic}}"
    - id: merge
      type: transform
      dependsOn: [gather-a, gather-b]
      template: |
        # DAG Report — {{date}}
        - {{nodes.gather-a.output}}
        - {{nodes.gather-b.output}}
  outputs:
    summary:
      from: nodes.merge.output
---

# Example DAG

Parallel gather nodes merge into a single report. Run with:

```bash
anvio workflow run example-dag topic=monorepo
```
