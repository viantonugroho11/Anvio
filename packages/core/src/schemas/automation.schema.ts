import { z } from 'zod';

export const automationTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cron'),
    schedule: z.string().min(1),
    timezone: z.string().default('UTC'),
    catchUp: z.boolean().default(false),
    maxCatchUp: z.number().int().positive().default(1),
  }),
  z.object({
    type: z.literal('event'),
    event: z.string().min(1),
    filter: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal('goal'),
    event: z.enum(['goal.created', 'goal.completed', 'goal.progress.updated']),
    goalSlug: z.string().optional(),
  }),
  z.object({
    type: z.literal('workflow'),
    event: z.literal('workflow.completed'),
    workflowId: z.string().optional(),
  }),
]);

export const automationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('blueprint'),
    blueprint: z.string().min(1),
    inputs: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('agent'),
    agent: z.string().min(1),
    input: z.string().default(''),
  }),
  z.object({
    type: z.literal('hook'),
    hook: z.string().min(1),
  }),
  z.object({
    type: z.literal('batch'),
    blueprint: z.string().min(1),
    inputPath: z.string().optional(),
  }),
]);

export const automationRetrySchema = z.object({
  maxAttempts: z.number().int().positive().default(3),
  backoff: z.enum(['exponential', 'fixed']).default('exponential'),
});

export const automationSpecSchema = z.object({
  description: z.string().default(''),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  retry: automationRetrySchema.default({}),
  onFailure: z
    .object({
      notify: z.boolean().default(false),
      hook: z.string().optional(),
    })
    .default({}),
});

export const automationDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Automation'),
  metadata: z.object({
    slug: z.string().min(1),
    enabled: z.boolean().default(true),
  }),
  spec: automationSpecSchema,
});

export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;

export function parseAutomationDefinition(input: unknown): AutomationDefinition {
  return automationDefinitionSchema.parse(input);
}
