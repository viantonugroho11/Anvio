import { z } from 'zod';

export const kanbanColumnSchema = z.enum(['backlog', 'todo', 'doing', 'review', 'done']);
export const kanbanPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const assigneeTypeSchema = z.enum(['human', 'agent']);
export const agentWorkStatusSchema = z.enum([
  'idle',
  'assigned',
  'working',
  'blocked',
  'review',
  'done',
]);

export const assigneeStateSchema = z.object({
  status: agentWorkStatusSchema.default('idle'),
  startedAt: z.string().optional(),
  sessionId: z.string().optional(),
});

export const kanbanAssigneeSchema = z.object({
  type: assigneeTypeSchema,
  id: z.string().min(1),
  state: assigneeStateSchema.default({ status: 'idle' }),
});

export const kanbanBoardSpecSchema = z.object({
  columns: z.array(kanbanColumnSchema).default(['backlog', 'todo', 'doing', 'review', 'done']),
  defaultLane: z.string().default('coding'),
  wipLimits: z.record(z.number().int().min(0)).default({}),
});

export const kanbanBoardSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('KanbanBoard'),
  metadata: z.object({
    slug: z.string().min(1),
    createdAt: z.string().optional(),
  }),
  spec: kanbanBoardSpecSchema,
});

export const kanbanTaskSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  column: kanbanColumnSchema.default('backlog'),
  priority: kanbanPrioritySchema.default('medium'),
  assignees: z.array(kanbanAssigneeSchema).default([]),
  linkedGoal: z.string().optional(),
  requiredSkills: z.array(z.string()).default([]),
  lane: z.string().optional(),
  labels: z.array(z.string()).default([]),
  board: z.string().default('default'),
});

export const kanbanTaskSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('KanbanTask'),
  metadata: z.object({
    id: z.string().min(1),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
  spec: kanbanTaskSpecSchema,
});

export const workerLaneSpecSchema = z.object({
  description: z.string().default(''),
  requiredSkills: z.array(z.string()).default([]),
  preferredAgents: z.array(z.string()).default([]),
  autoAssign: z.boolean().default(true),
  concurrency: z.number().int().min(1).default(1),
});

export const workerLaneSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('WorkerLane'),
  metadata: z.object({
    slug: z.string().min(1),
  }),
  spec: workerLaneSpecSchema,
});

export type KanbanColumn = z.infer<typeof kanbanColumnSchema>;
export type KanbanPriority = z.infer<typeof kanbanPrioritySchema>;
export type AgentWorkStatus = z.infer<typeof agentWorkStatusSchema>;
export type AssigneeState = z.infer<typeof assigneeStateSchema>;
export type KanbanAssignee = z.infer<typeof kanbanAssigneeSchema>;
export type KanbanBoard = z.infer<typeof kanbanBoardSchema>;
export type KanbanTask = z.infer<typeof kanbanTaskSchema>;
export type WorkerLane = z.infer<typeof workerLaneSchema>;

export function parseKanbanBoard(input: unknown): KanbanBoard {
  return kanbanBoardSchema.parse(input);
}

export function parseKanbanTask(input: unknown): KanbanTask {
  return kanbanTaskSchema.parse(input);
}

export function parseWorkerLane(input: unknown): WorkerLane {
  return workerLaneSchema.parse(input);
}
