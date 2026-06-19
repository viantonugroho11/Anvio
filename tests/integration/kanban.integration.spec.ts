import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AnvioError } from '@anvio/core';
import { createKanbanEngine } from '@anvio/kanban';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';

describe('Kanban & Worker Lanes', () => {
  let tmpDir: string;
  let kanban: ReturnType<typeof createKanbanEngine>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-kanban-'));
    await Workspace.init(tmpDir);
    const storage = new FilesystemStorageProvider(tmpDir);
    kanban = createKanbanEngine({ storage });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates task and moves through columns to done', async () => {
    const task = await kanban.createTask({ title: 'Refactor Auth', column: 'backlog' });
    expect(task.spec.column).toBe('backlog');

    await kanban.moveTask(task.metadata.id, 'todo');
    await kanban.moveTask(task.metadata.id, 'doing');
    await kanban.moveTask(task.metadata.id, 'review');
    const done = await kanban.moveTask(task.metadata.id, 'done');

    expect(done.spec.column).toBe('done');
  });

  it('auto-assigns task to lane-capable agent', async () => {
    const task = await kanban.createTask({
      title: 'Implement feature',
      lane: 'coding',
      requiredSkills: ['coding'],
    });

    const assigned = await kanban.autoAssign(task.metadata.id);
    expect(assigned?.spec.assignees.some((a) => a.id === 'software-engineer')).toBe(true);
  });

  it('WIP limit blocks move to doing', async () => {
    for (let i = 0; i < 3; i += 1) {
      const t = await kanban.createTask({ title: `Task ${i}`, column: 'todo' });
      await kanban.moveTask(t.metadata.id, 'doing');
    }

    const extra = await kanban.createTask({ title: 'Overflow', column: 'todo' });
    await expect(kanban.moveTask(extra.metadata.id, 'doing')).rejects.toThrow(AnvioError);
  });

  it('updates per-agent state independently', async () => {
    const task = await kanban.createTask({ title: 'Multi-agent work' });
    await kanban.assignAgent(task.metadata.id, 'architect');
    await kanban.assignAgent(task.metadata.id, 'software-engineer');

    await kanban.updateAgentState(task.metadata.id, 'architect', {
      status: 'working',
      sessionId: 'sess-arch',
    });
    const updated = await kanban.updateAgentState(task.metadata.id, 'software-engineer', {
      status: 'idle',
    });

    const arch = updated.spec.assignees.find((a) => a.id === 'architect');
    const coder = updated.spec.assignees.find((a) => a.id === 'software-engineer');
    expect(arch?.state.status).toBe('working');
    expect(coder?.state.status).toBe('idle');
  });
});
