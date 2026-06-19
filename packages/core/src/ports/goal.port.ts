import type {
  GoalDefinition,
  GoalPriority,
  GoalSpec,
  GoalStatus,
} from '../schemas/goal.schema.js';

export interface CreateGoalInput {
  slug: string;
  spec: Pick<GoalSpec, 'title'> & Partial<Omit<GoalSpec, 'title'>>;
}

export interface UpdateGoalProgressInput {
  percent?: number;
  milestone?: { name: string; completed: boolean };
}

export interface GoalStore {
  list(status?: GoalStatus): Promise<GoalDefinition[]>;
  get(slug: string): Promise<GoalDefinition | null>;
  create(input: CreateGoalInput): Promise<GoalDefinition>;
  update(slug: string, patch: Partial<GoalSpec>): Promise<GoalDefinition>;
  delete(slug: string): Promise<boolean>;
  getOrderedSlugs(): Promise<string[]>;
  setOrder(slugs: string[]): Promise<void>;
}

export interface GoalEngine {
  create(input: CreateGoalInput): Promise<GoalDefinition>;
  updateProgress(slug: string, input: UpdateGoalProgressInput): Promise<GoalDefinition>;
  complete(slug: string): Promise<GoalDefinition>;
  pause(slug: string): Promise<GoalDefinition>;
  resume(slug: string): Promise<GoalDefinition>;
  prioritize(slugs: string[]): Promise<void>;
  list(status?: GoalStatus): Promise<GoalDefinition[]>;
  get(slug: string): Promise<GoalDefinition | null>;
}

export type { GoalStatus, GoalPriority };
