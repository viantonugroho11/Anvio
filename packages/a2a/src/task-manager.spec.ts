import { describe, it, expect } from 'vitest';
import { TaskManager } from './server/task-manager.js';

describe('TaskManager', () => {
  it('creates a task with submitted state', () => {
    const tm = new TaskManager();
    const task = tm.createTask('ctx-1');
    expect(task.id).toMatch(/^task_/);
    expect(task.status.state).toBe('submitted');
    expect(task.contextId).toBe('ctx-1');
  });

  it('transitions through lifecycle states', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    tm.updateStatus(task.id, 'working');
    expect(tm.getTask(task.id).status.state).toBe('working');
    tm.updateStatus(task.id, 'completed');
    expect(tm.getTask(task.id).status.state).toBe('completed');
    expect(tm.isTerminal(task.id)).toBe(true);
  });

  it('throws on unknown task id', () => {
    const tm = new TaskManager();
    expect(() => tm.getTask('nope')).toThrow('not found');
  });

  it('cancels a non-terminal task', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    tm.updateStatus(task.id, 'working');
    const canceled = tm.cancelTask(task.id);
    expect(canceled.status.state).toBe('canceled');
  });

  it('rejects cancel on terminal task', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    tm.updateStatus(task.id, 'completed');
    expect(() => tm.cancelTask(task.id)).toThrow('terminal');
  });

  it('notifies subscribers on status update', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    const events: unknown[] = [];
    tm.subscribe(task.id, (e) => events.push(e));
    tm.updateStatus(task.id, 'working');
    tm.updateStatus(task.id, 'completed');
    expect(events).toHaveLength(2);
    expect((events[0] as any).status.state).toBe('working');
    expect((events[1] as any).status.state).toBe('completed');
  });

  it('notifies subscribers on artifact add', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    const events: unknown[] = [];
    tm.subscribe(task.id, (e) => events.push(e));
    tm.addArtifact(task.id, { id: 'a1', parts: [{ type: 'text', text: 'hello' }] });
    expect(events).toHaveLength(1);
    expect((events[0] as any).artifact.id).toBe('a1');
  });

  it('unsubscribe stops notifications', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    const events: unknown[] = [];
    const unsub = tm.subscribe(task.id, (e) => events.push(e));
    tm.updateStatus(task.id, 'working');
    unsub();
    tm.updateStatus(task.id, 'completed');
    expect(events).toHaveLength(1);
  });

  it('lists tasks with pagination', () => {
    const tm = new TaskManager();
    tm.createTask('ctx-a');
    tm.createTask('ctx-a');
    tm.createTask('ctx-b');

    const all = tm.listTasks();
    expect(all.totalSize).toBe(3);

    const filtered = tm.listTasks('ctx-a');
    expect(filtered.totalSize).toBe(2);

    const paged = tm.listTasks(undefined, 2);
    expect(paged.tasks).toHaveLength(2);
    expect(paged.nextPageToken).not.toBe('');
  });

  it('appends history messages', () => {
    const tm = new TaskManager();
    const task = tm.createTask();
    tm.appendHistory(task.id, {
      messageId: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    });
    expect(tm.getTask(task.id).history).toHaveLength(1);
  });
});
