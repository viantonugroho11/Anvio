# Workflow Engine (Phase I)

Standalone DAG executor in `@anvio/workflows`. Blueprints can delegate complex graphs via a `workflow` step.

## Layout

```
workspace/workflows/     # DAG definitions (Workflow kind)
packages/workflows/      # DagExecutor + WorkflowRegistry
```

## CLI

```bash
anvio workflow list
anvio workflow validate workspace/workflows/example-dag.yaml
anvio workflow run example-dag topic=architecture
anvio workflow run example-dag --dry-run
```

## DAG Semantics

- Nodes declare `dependsOn: [node-id, ...]` — executor runs ready nodes in parallel batches.
- Node types mirror blueprint steps: `agent`, `transform`, `conditional`, `parallel`, `workflow`, etc.
- Outputs use `nodes.<id>.output` template paths.

## Blueprint Integration

```yaml
steps:
  - id: pipeline
    type: workflow
    workflow: example-dag
```

Wire `runWorkflow` in `BlueprintExecutor` deps (platform does this when workflow registry is available).

## Events

Completed runs emit `anvio.workflow.completed.v1` (automation triggers on `workflow.completed`).
