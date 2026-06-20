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

export async function kanbanCompleteTask(
  kanban: KanbanStore | undefined,
  taskId: string,
): Promise<{ task: unknown }> {
  return kanbanMoveTask(kanban, taskId, 'done');
}

export async function kanbanBlockTask(
  kanban: KanbanStore | undefined,
  taskId: string,
  agentId: string,
  reason?: string,
): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const task = await kanban.updateAgentState(taskId, agentId, { status: 'blocked' });
  if (reason) {
    const updated = await kanban.updateTask(taskId, {
      appendDescription: `[blocked ${new Date().toISOString()}] ${reason}`,
    });
    return { task: updated };
  }
  return { task };
}

export async function kanbanUnblockTask(
  kanban: KanbanStore | undefined,
  taskId: string,
  agentId: string,
): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const task = await kanban.updateAgentState(taskId, agentId, { status: 'working' });
  return { task };
}

export async function kanbanHeartbeatTask(
  kanban: KanbanStore | undefined,
  taskId: string,
  agentId: string,
  note?: string,
): Promise<{ task: unknown; heartbeatAt: string }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const heartbeatAt = new Date().toISOString();
  const task = await kanban.updateAgentState(taskId, agentId, { status: 'working', startedAt: heartbeatAt });
  if (note) {
    const updated = await kanban.updateTask(taskId, {
      appendDescription: `[heartbeat ${heartbeatAt}] ${note}`,
    });
    return { task: updated, heartbeatAt };
  }
  return { task, heartbeatAt };
}

export async function kanbanCommentTask(
  kanban: KanbanStore | undefined,
  taskId: string,
  comment: string,
): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  const task = await kanban.updateTask(taskId, {
    appendDescription: `[comment ${new Date().toISOString()}] ${comment}`,
  });
  return { task };
}

export async function kanbanLinkTask(
  kanban: KanbanStore | undefined,
  taskId: string,
  link: string,
  linkType: 'goal' | 'task' = 'goal',
): Promise<{ task: unknown }> {
  if (!kanban) throw new Error('kanbanEngine required');
  if (linkType === 'goal') {
    const task = await kanban.updateTask(taskId, { linkedGoal: link });
    return { task };
  }
  const existing = await kanban.getTask(taskId);
  if (!existing) throw new Error(`Task not found: ${taskId}`);
  const labels = [...existing.spec.labels, `link:task:${link}`];
  const task = await kanban.updateTask(taskId, { labels });
  return { task };
}
