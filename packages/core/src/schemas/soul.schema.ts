import { z } from 'zod';

export const soulIdentitySchema = z.object({
  role: z.string().optional(),
  description: z.string().optional(),
});

export const soulCommunicationStyleSchema = z.object({
  tone: z.string().default('professional'),
  format: z.string().default('clear and concise'),
});

export const soulRelationshipMemorySchema = z.object({
  provider: z.enum(['filesystem', 'sqlite', 'postgresql', 'qdrant', 'honcho']).default('filesystem'),
  path: z.string().default('relationship'),
});

export const soulEvolutionSchema = z.object({
  allowAutoUpdate: z.boolean().default(true),
  requireApproval: z.boolean().default(false),
});

export const soulSpecSchema = z.object({
  name: z.string().min(1),
  identity: soulIdentitySchema.default({}),
  values: z.array(z.string()).default([]),
  personality: z.array(z.string()).default([]),
  preferences: z.record(z.string()).default({}),
  communicationStyle: soulCommunicationStyleSchema.default({}),
  longTermGoals: z.array(z.string()).default([]),
  behavioralTendencies: z.array(z.string()).default([]),
  relationshipMemory: soulRelationshipMemorySchema.default({}),
  evolution: soulEvolutionSchema.default({}),
  extensions: z.record(z.unknown()).optional(),
});

export const soulDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Soul'),
  metadata: z.object({
    slug: z.string().min(1),
    version: z.string().default('1.0.0'),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
  spec: soulSpecSchema,
});

export type SoulDefinition = z.infer<typeof soulDefinitionSchema>;
export type SoulSpec = z.infer<typeof soulSpecSchema>;

export function parseSoulDefinition(input: unknown): SoulDefinition {
  return soulDefinitionSchema.parse(input);
}
