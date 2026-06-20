import type { KanbanColumn, KanbanStore } from '@anvio/core';

export async function kanbanListTasks(
  kanban: KanbanStore | undefined,
  board?: string,
  column?: KanbanColumn,
): Promise<{ tasks: unknown[] }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const tasks = await kanban.listTasks(board, column);
  return { tasks };
}

export async function kanbanShowTask(kanban: KanbanStore | undefined, taskId: string): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const task = await kanban.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return { task };
}

export async function kanbanCreateTask(
  kanban: KanbanStore | undefined,
  input: { title: string; description?: string; column?: KanbanColumn; board?: string },
): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const task = await kanban.createTask(input);
  return { task };
}

export async function kanbanMoveTask(
  kanban: KanbanStore | undefined,
  taskId: string,
  column: KanbanColumn,
): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const task = await kanban.moveTask(taskId, column);
  return { task };
}
