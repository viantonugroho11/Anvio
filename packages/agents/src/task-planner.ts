import type { SubAgentTask } from '@anvio/core';
import { AnvioError } from '@anvio/core';

export interface PlannedTask extends SubAgentTask {
  id: string;
}

export function resolveTaskId(task: SubAgentTask, index: number): string {
  return task.id ?? `${task.agentId}-${index}`;
}

export function normalizeTasks(tasks: SubAgentTask[]): PlannedTask[] {
  return tasks.map((task, index) => ({
    ...task,
    id: resolveTaskId(task, index),
    sessionId: task.sessionId,
  }));
}

export function resolveTaskOrder(tasks: PlannedTask[]): PlannedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: PlannedTask[] = [];

  const visit = (task: PlannedTask): void => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) {
      throw new AnvioError('VALIDATION_ERROR', 'Cyclic dependency detected in orchestration plan', {
        details: { taskId: task.id },
      });
    }
    visiting.add(task.id);
    for (const depId of task.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (!dep) {
        throw new AnvioError('NOT_FOUND', `Unknown dependency: ${depId}`, {
          details: { taskId: task.id, depId },
        });
      }
      visit(dep);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  };

  for (const task of tasks) {
    visit(task);
  }

  return ordered;
}

export function getReadyTasks(
  tasks: PlannedTask[],
  completed: Set<string>,
  failed: Set<string>,
  skipped: Set<string>,
): PlannedTask[] {
  return tasks.filter((task) => {
    if (completed.has(task.id) || failed.has(task.id) || skipped.has(task.id)) {
      return false;
    }
    const deps = task.dependsOn ?? [];
    if (deps.length === 0) return true;
    return deps.every((depId) => completed.has(depId));
  });
}

export function shouldSkipDependent(
  task: PlannedTask,
  failed: Set<string>,
  skipped: Set<string>,
): boolean {
  for (const depId of task.dependsOn ?? []) {
    if (failed.has(depId) || skipped.has(depId)) return true;
  }
  return false;
}

export function interpolateTaskInput(
  input: string,
  outputs: Map<string, string>,
): string {
  return input.replace(/\{\{tasks\.([^.}]+)\.output\}\}/g, (_match, taskId: string) => {
    return outputs.get(taskId) ?? '';
  });
}
