import { z } from 'zod';

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
  }),
});

export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;

export function parseSkillDefinition(input: unknown): SkillDefinition {
  return skillDefinitionSchema.parse(input);
}
