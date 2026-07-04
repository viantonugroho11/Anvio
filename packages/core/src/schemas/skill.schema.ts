import { z } from 'zod';

// ---------------------------------------------------------------------------
// Skill parameter — typed input the agent must collect / receive
// ---------------------------------------------------------------------------
export const skillParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']).default('string'),
  description: z.string().optional(),
  required: z.boolean().default(true),
  default: z.unknown().optional(),
  enum: z.array(z.string()).optional(),
});

export type SkillParameter = z.infer<typeof skillParameterSchema>;

// ---------------------------------------------------------------------------
// Skill step — structured execution unit with optional tool binding
// ---------------------------------------------------------------------------
export const skillStepSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  tool: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  condition: z.string().optional(),
  onError: z.enum(['fail', 'skip', 'retry']).default('fail'),
  maxRetries: z.number().int().min(0).default(0),
  output: z.string().optional(),
  goalSlug: z.string().optional(),
  progressIncrement: z.number().min(0).max(100).optional(),
});

export type SkillStep = z.infer<typeof skillStepSchema>;

// ---------------------------------------------------------------------------
// Skill output — structured result definition
// ---------------------------------------------------------------------------
export const skillOutputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object', 'markdown']).default('string'),
  description: z.string().optional(),
});

export type SkillOutput = z.infer<typeof skillOutputSchema>;

// ---------------------------------------------------------------------------
// Skill trigger — event or pattern that activates the skill
// ---------------------------------------------------------------------------
export const skillTriggerSchema = z.union([
  z.string(),
  z.object({
    event: z.string().min(1),
    condition: z.string().optional(),
    channel: z.string().optional(),
  }),
]);

export type SkillTrigger = z.infer<typeof skillTriggerSchema>;

// ---------------------------------------------------------------------------
// Full skill definition
// ---------------------------------------------------------------------------
export const skillDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Skill'),
  metadata: z.object({
    slug: z.string().min(1),
    version: z.string().default('1.0.0'),
    catalog: z.enum(['bundled', 'community', 'team', 'private']).optional(),
  }),
  spec: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    instructions: z.string().min(1),
    permissions: z.array(z.string()).default([]),
    toolRequirements: z.array(z.string()).default([]),
    contextRequirements: z.array(z.string()).default([]),
    category: z.string().optional(),
    routing: z.string().optional(),
    tags: z.array(z.string()).default([]),
    parameters: z.array(skillParameterSchema).default([]),
    steps: z.array(skillStepSchema).default([]),
    outputs: z.array(skillOutputSchema).default([]),
    triggers: z.array(skillTriggerSchema).default([]),
    composable: z.boolean().default(false),
    timeout: z.number().int().positive().optional(),
  }),
});

export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

export function parseSkillDefinition(input: unknown): SkillDefinition {
  return skillDefinitionSchema.parse(input);
}
