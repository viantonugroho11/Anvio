import { z } from 'zod';

export const goalStatusSchema = z.enum(['active', 'paused', 'completed', 'archived']);
export const goalPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const goalMilestoneSchema = z.object({
  name: z.string().min(1),
  completed: z.boolean().default(false),
  completedAt: z.string().optional(),
});

export const goalProgressSchema = z.object({
  percent: z.number().min(0).max(100).default(0),
  milestones: z.array(goalMilestoneSchema).default([]),
});

export const goalAssigneeSchema = z.object({
  type: z.enum(['human', 'agent']),
  id: z.string().min(1),
});

export const goalSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  status: goalStatusSchema.default('active'),
  priority: goalPrioritySchema.default('medium'),
  progress: goalProgressSchema.default({ percent: 0, milestones: [] }),
  assignedAgents: z.array(z.string()).default([]),
  assignees: z.array(goalAssigneeSchema).default([]),
  linkedTasks: z.array(z.string()).default([]),
  automations: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().optional(),
  extensions: z.record(z.unknown()).optional(),
});

export const goalDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Goal'),
  metadata: z.object({
    slug: z.string().min(1),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
  spec: goalSpecSchema,
});

export const goalIndexSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('GoalIndex'),
  spec: z.object({
    order: z.array(z.string()).default([]),
  }),
});

export type GoalDefinition = z.infer<typeof goalDefinitionSchema>;
export type GoalSpec = z.infer<typeof goalSpecSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type GoalPriority = z.infer<typeof goalPrioritySchema>;

export function parseGoalDefinition(input: unknown): GoalDefinition {
  return goalDefinitionSchema.parse(input);
}

export function parseGoalIndex(input: unknown): z.infer<typeof goalIndexSchema> {
  return goalIndexSchema.parse(input);
}
