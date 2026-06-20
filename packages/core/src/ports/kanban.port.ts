import type {
  AgentWorkStatus,
  AssigneeState,
  KanbanBoard,
  KanbanColumn,
  KanbanPriority,
  KanbanTask,
  WorkerLane,
} from '../schemas/kanban.schema.js';

export interface CreateKanbanTaskInput {
  title: string;
  description?: string;
  column?: KanbanColumn;
  priority?: KanbanPriority;
  board?: string;
  lane?: string;
  requiredSkills?: string[];
  linkedGoal?: string;
  labels?: string[];
}

export interface KanbanStore {
  listBoards(): Promise<KanbanBoard[]>;
  getBoard(slug: string): Promise<KanbanBoard | null>;
  listTasks(board?: string, column?: KanbanColumn): Promise<KanbanTask[]>;
  getTask(id: string): Promise<KanbanTask | null>;
  createTask(input: CreateKanbanTaskInput): Promise<KanbanTask>;
  moveTask(id: string, column: KanbanColumn): Promise<KanbanTask>;
  assignAgent(taskId: string, agentId: string): Promise<KanbanTask>;
  updateAgentState(
    taskId: string,
    agentId: string,
    state: Partial<AssigneeState> & { status?: AgentWorkStatus },
  ): Promise<KanbanTask>;
  updateTask(
    id: string,
    patch: {
      description?: string;
      labels?: string[];
      linkedGoal?: string;
      appendDescription?: string;
    },
  ): Promise<KanbanTask>;
  listLanes(): Promise<WorkerLane[]>;
}

export interface KanbanEngine extends KanbanStore {
  autoAssign(taskId: string): Promise<KanbanTask | null>;
}
