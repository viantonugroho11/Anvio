import { z } from 'zod';

export const hookEventNameSchema = z.enum([
  'onSessionStart',
  'onSessionEnd',
  'onGoalCreated',
  'onGoalCompleted',
  'onTaskAssigned',
  'onTaskCompleted',
  'onToolExecuted',
  'onWorkflowCompleted',
  'onSoulEvolved',
  'onAutomationFailed',
]);

export const hookHandlerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('script'),
    path: z.string().min(1),
    timeoutMs: z.number().int().positive().default(5000),
    filter: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().url(),
    method: z.enum(['POST', 'PUT']).default('POST'),
    headers: z.record(z.string()).optional(),
    body: z.record(z.unknown()).optional(),
    timeoutMs: z.number().int().positive().default(10000),
    filter: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal('mcp'),
    server: z.string().min(1),
    tool: z.string().min(1),
    args: z.record(z.unknown()).default({}),
    timeoutMs: z.number().int().positive().default(10000),
    filter: z.record(z.string()).optional(),
  }),
]);

export const hookBindingSchema = z.object({
  event: hookEventNameSchema,
  handlers: z.array(hookHandlerSchema).default([]),
});

export const hookRegistrySchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('HookRegistry'),
  spec: z.object({
    hooks: z.array(hookBindingSchema).default([]),
  }),
});

export type HookEventName = z.infer<typeof hookEventNameSchema>;
export type HookHandler = z.infer<typeof hookHandlerSchema>;
export type HookRegistry = z.infer<typeof hookRegistrySchema>;

export function parseHookRegistry(input: unknown): HookRegistry {
  return hookRegistrySchema.parse(input);
}
