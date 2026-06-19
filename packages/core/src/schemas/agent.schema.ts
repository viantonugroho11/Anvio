import { z } from 'zod';

export const agentModelSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama', 'openrouter']),
  model: z.string().min(1),
  maxTokens: z.number().int().positive().default(8192),
  temperature: z.number().min(0).max(2).optional(),
});

export const agentMemorySchema = z.object({
  shortTerm: z
    .object({
      enabled: z.boolean().default(true),
      ttlSeconds: z.number().int().positive().default(3600),
    })
    .default({ enabled: true, ttlSeconds: 3600 }),
  longTerm: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  semantic: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
});

export const agentOrchestrationSchema = z.object({
  pattern: z.enum(['single', 'supervisor', 'parallel', 'hierarchical']).default('single'),
  delegates: z.array(z.string()).default([]),
});

export const agentApprovalsSchema = z.object({
  requiredFor: z
    .array(z.enum(['destructive', 'external-write', 'filesystem', 'database']))
    .default(['destructive']),
});

export const agentSpecSchema = z.object({
  description: z.string().min(1),
  persona: z.string().min(1),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  model: agentModelSchema,
  memory: agentMemorySchema.default({}),
  orchestration: agentOrchestrationSchema.default({ pattern: 'single', delegates: [] }),
  approvals: agentApprovalsSchema.default({ requiredFor: ['destructive'] }),
});

export const agentDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Agent'),
  metadata: z.object({
    name: z.string().min(1),
    version: z.string().default('1.0.0'),
  }),
  spec: agentSpecSchema,
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type AgentSpec = z.infer<typeof agentSpecSchema>;

export function parseAgentDefinition(input: unknown): AgentDefinition {
  return agentDefinitionSchema.parse(input);
}
