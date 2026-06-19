import type { FilesystemStorageProvider } from '@anvio/storage';
import type { KanbanBoard, KanbanColumn, KanbanTask, WorkerLane } from '@anvio/core';
import { AnvioError, parseKanbanBoard, parseKanbanTask, parseWorkerLane } from '@anvio/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export class FilesystemTaskStore {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  private taskKey(id: string): string {
    return `kanban/tasks/${id}.yaml`;
  }

  async listTasks(board?: string, column?: KanbanColumn): Promise<KanbanTask[]> {
    const files = await this.storage.list('kanban/tasks');
    const tasks: KanbanTask[] = [];
    for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      const task = parseKanbanTask(parseYaml(raw));
      if (board && task.spec.board !== board) continue;
      if (column && task.spec.column !== column) continue;
      tasks.push(task);
    }
    return tasks.sort((a, b) => (a.metadata.createdAt ?? '').localeCompare(b.metadata.createdAt ?? ''));
  }

  async getTask(id: string): Promise<KanbanTask | null> {
    const raw = await this.storage.read(this.taskKey(id));
    if (!raw) return null;
    return parseKanbanTask(parseYaml(raw));
  }

  async saveTask(task: KanbanTask): Promise<void> {
    await this.storage.write(this.taskKey(task.metadata.id), stringifyYaml(task));
  }

  async listBoards(): Promise<KanbanBoard[]> {
    const files = await this.storage.list('kanban/boards');
    const boards: KanbanBoard[] = [];
    for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      boards.push(parseKanbanBoard(parseYaml(raw)));
    }
    return boards;
  }

  async getBoard(slug: string): Promise<KanbanBoard | null> {
    const raw = await this.storage.read(`kanban/boards/${slug}.yaml`);
    if (!raw) return null;
    return parseKanbanBoard(parseYaml(raw));
  }

  async listLanes(): Promise<WorkerLane[]> {
    const files = await this.storage.list('kanban/lanes');
    const lanes: WorkerLane[] = [];
    for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      lanes.push(parseWorkerLane(parseYaml(raw)));
    }
    return lanes;
  }
}

export async function ensureDefaultBoard(storage: FilesystemStorageProvider): Promise<KanbanBoard> {
  const existing = await storage.read('kanban/boards/default.yaml');
  if (existing) return parseKanbanBoard(parseYaml(existing));

  const board: KanbanBoard = {
    apiVersion: 'anvio.io/v1',
    kind: 'KanbanBoard',
    metadata: { slug: 'default', createdAt: new Date().toISOString() },
    spec: {
      columns: ['backlog', 'todo', 'doing', 'review', 'done'],
      defaultLane: 'coding',
      wipLimits: { doing: 3, review: 2 },
    },
  };
  await storage.write('kanban/boards/default.yaml', stringifyYaml(board));
  return board;
}

export function assertWipLimit(
  board: KanbanBoard,
  column: KanbanColumn,
  currentCount: number,
): void {
  const limit = board.spec.wipLimits[column];
  if (limit !== undefined && currentCount >= limit) {
    throw new AnvioError('CONFLICT', `WIP limit reached for column "${column}" (${limit})`, {
      details: { column, limit },
    });
  }
}
