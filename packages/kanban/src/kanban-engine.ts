import type {
  CreateKanbanTaskInput,
  KanbanColumn,
  KanbanEngine,
  KanbanTask,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';
import type { EventBusLike } from '@anvio/events';
import { EventSubjects } from '@anvio/events';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { randomUUID } from 'node:crypto';
import {
  assertWipLimit,
  ensureDefaultBoard,
  FilesystemTaskStore,
} from './filesystem-task-store.js';
import {
  defaultAgentCapabilities,
  defaultWorkerLanes,
  LaneRouter,
} from './lane-router.js';

export interface KanbanEngineDeps {
  storage: FilesystemStorageProvider;
  eventBus?: EventBusLike;
  agentCapabilities?: Array<{ id: string; skills: string[] }>;
}

export class KanbanEngineImpl implements KanbanEngine {
  private readonly store: FilesystemTaskStore;
  private router: LaneRouter;

  constructor(private readonly deps: KanbanEngineDeps) {
    this.store = new FilesystemTaskStore(deps.storage);
    this.router = new LaneRouter(defaultWorkerLanes(), deps.agentCapabilities ?? defaultAgentCapabilities());
  }

  async refreshRouter(): Promise<void> {
    const lanes = await this.listLanes();
    this.router = new LaneRouter(
      lanes.length > 0 ? lanes : defaultWorkerLanes(),
      this.deps.agentCapabilities ?? defaultAgentCapabilities(),
    );
  }

  async listBoards() {
    await ensureDefaultBoard(this.deps.storage);
    return this.store.listBoards();
  }

  async getBoard(slug: string) {
    return this.store.getBoard(slug);
  }

  async listTasks(board?: string, column?: KanbanColumn) {
    return this.store.listTasks(board, column);
  }

  async getTask(id: string) {
    return this.store.getTask(id);
  }

  async createTask(input: CreateKanbanTaskInput): Promise<KanbanTask> {
    await ensureDefaultBoard(this.deps.storage);
    const boardSlug = input.board ?? 'default';
    const board = await this.store.getBoard(boardSlug);
    if (!board) {
      throw new AnvioError('NOT_FOUND', `Board not found: ${boardSlug}`);
    }

    const now = new Date().toISOString();
    const task: KanbanTask = {
      apiVersion: 'anvio.io/v1',
      kind: 'KanbanTask',
      metadata: { id: `task-${randomUUID().slice(0, 8)}`, createdAt: now, updatedAt: now },
      spec: {
        title: input.title,
        description: input.description ?? '',
        column: input.column ?? 'backlog',
        priority: input.priority ?? 'medium',
        assignees: [],
        linkedGoal: input.linkedGoal,
        requiredSkills: input.requiredSkills ?? [],
        lane: input.lane ?? board.spec.defaultLane,
        labels: input.labels ?? [],
        board: boardSlug,
      },
    };

    await this.store.saveTask(task);
    return task;
  }

  async moveTask(id: string, column: KanbanColumn): Promise<KanbanTask> {
    const task = await this.store.getTask(id);
    if (!task) {
      throw new AnvioError('NOT_FOUND', `Task not found: ${id}`);
    }

    const board = await this.store.getBoard(task.spec.board);
    if (board) {
      const inColumn = (await this.store.listTasks(task.spec.board, column)).filter(
        (t) => t.metadata.id !== id,
      );
      assertWipLimit(board, column, inColumn.length);
    }

    task.spec.column = column;
    task.metadata.updatedAt = new Date().toISOString();
    await this.store.saveTask(task);
    return task;
  }

  async assignAgent(taskId: string, agentId: string): Promise<KanbanTask> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new AnvioError('NOT_FOUND', `Task not found: ${taskId}`);
    }

    const existing = task.spec.assignees.find((a) => a.type === 'agent' && a.id === agentId);
    if (!existing) {
      task.spec.assignees.push({
        type: 'agent',
        id: agentId,
        state: { status: 'assigned', startedAt: new Date().toISOString() },
      });
    }

    task.metadata.updatedAt = new Date().toISOString();
    await this.store.saveTask(task);

    await this.deps.eventBus?.publishCore(EventSubjects.TASK_ASSIGNED, 'anvio.task.assigned', {
      taskId,
      agentId,
      board: task.spec.board,
    });

    return task;
  }

  async updateAgentState(
    taskId: string,
    agentId: string,
    state: { status?: KanbanTask['spec']['assignees'][number]['state']['status']; startedAt?: string; sessionId?: string },
  ): Promise<KanbanTask> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new AnvioError('NOT_FOUND', `Task not found: ${taskId}`);
    }

    const assignee = task.spec.assignees.find((a) => a.type === 'agent' && a.id === agentId);
    if (!assignee) {
      throw new AnvioError('NOT_FOUND', `Agent ${agentId} not assigned to task ${taskId}`);
    }

    assignee.state = { ...assignee.state, ...state };
    task.metadata.updatedAt = new Date().toISOString();
    await this.store.saveTask(task);

    if (state.status === 'done') {
      await this.deps.eventBus?.publishCore(EventSubjects.TASK_COMPLETED, 'anvio.task.completed', {
        taskId,
        agentId,
      });
    }

    return task;
  }

  async listLanes() {
    const lanes = await this.store.listLanes();
    return lanes.length > 0 ? lanes : defaultWorkerLanes();
  }

  async autoAssign(taskId: string): Promise<KanbanTask | null> {
    await this.refreshRouter();
    const task = await this.store.getTask(taskId);
    if (!task) return null;

    const laneSlug = task.spec.lane ?? 'coding';
    const lane = this.router.findLane(laneSlug);
    if (lane && !lane.spec.autoAssign) return task;

    const agentId = this.router.resolveAgentForLane(laneSlug, task.spec.requiredSkills);
    if (!agentId) return task;

    return this.assignAgent(taskId, agentId);
  }
}

export function createKanbanEngine(deps: KanbanEngineDeps): KanbanEngine {
  return new KanbanEngineImpl(deps);
}
