import { z } from 'zod';
import { modelProviderIdSchema } from './model-provider.schema.js';

export const agentModelSchema = z
  .object({
    provider: modelProviderIdSchema,
    model: z.string().min(1),
    maxTokens: z.number().int().positive().default(8192),
    temperature: z.number().min(0).max(2).optional(),
    /** Override base URL — required when provider is `custom`. */
    baseUrl: z.string().url().optional(),
    /** Env var name for API key (e.g. DEEPSEEK_API_KEY). */
    apiKeyEnv: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === 'custom' && !value.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'custom provider requires baseUrl',
        path: ['baseUrl'],
      });
    }
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

export const agentWorkspaceSchema = z.object({
  isolatedWorktree: z.boolean().default(false),
});

export const agentRuntimeBindingSchema = z.object({
  provider: z.enum(['local', 'cursor', 'claude-code', 'codex', 'antigravity']).optional(),
  /** Single fallback (shorthand). Ignored when `fallbacks` is set. */
  fallback: z.enum(['local', 'cursor', 'claude-code', 'codex', 'antigravity']).optional(),
  /** Ordered fallback chain after `provider` (e.g. cursor → codex → local). */
  fallbacks: z.array(z.enum(['local', 'cursor', 'claude-code', 'codex', 'antigravity'])).optional(),
  /**
   * Model id passed to the vendor runtime (e.g. `sonnet` for claude-code).
   * Separate from `spec.model.model`, which configures the `local` fallback's
   * model provider. Without this field, a claude-code runtime paired with a
   * non-Anthropic `spec.model` would hand the vendor an id it cannot serve —
   * see issue #49.
   */
  model: z.string().min(1).optional(),
});

export const agentSpecSchema = z
  .object({
    description: z.string().min(1),
    persona: z.string().min(1),
    soul: z.string().optional(),
    skills: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    model: agentModelSchema,
    memory: agentMemorySchema.default({}),
    orchestration: agentOrchestrationSchema.default({ pattern: 'single', delegates: [] }),
    approvals: agentApprovalsSchema.default({ requiredFor: ['destructive'] }),
    workspace: agentWorkspaceSchema.default({ isolatedWorktree: false }),
    runtime: agentRuntimeBindingSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // Vendor runtimes (claude-code / codex / antigravity) speak their vendor's
    // model ids. If `spec.model.provider` is set to something else (usually so
    // the `local` fallback can use a different key), the vendor still needs a
    // model id to pass through. `spec.runtime.model` is that id — without it,
    // the vendor gets a non-vendor id and every run fails (issue #49).
    const runtime = value.runtime;
    if (!runtime?.provider) return;
    const vendorRuntimeToProvider: Record<string, string> = {
      'claude-code': 'anthropic',
    };
    const requiredModelProvider = vendorRuntimeToProvider[runtime.provider];
    if (
      requiredModelProvider &&
      value.model.provider !== requiredModelProvider &&
      !runtime.model
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `runtime.provider '${runtime.provider}' needs runtime.model when spec.model.provider is not '${requiredModelProvider}' (spec.model.model is used only by the local fallback)`,
        path: ['runtime', 'model'],
      });
    }
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
