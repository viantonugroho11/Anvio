import { z } from 'zod';

export const personaProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  tone: z.string().default('professional'),
  behavior: z.array(z.string()).default([]),
  communicationStyle: z.string().default('clear and concise'),
  memoryPreferences: z
    .object({
      retainFacts: z.boolean().default(true),
      retainPreferences: z.boolean().default(true),
    })
    .default({ retainFacts: true, retainPreferences: true }),
  systemPrompt: z.string().min(1),
});

export const personaDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Persona'),
  metadata: z.object({
    slug: z.string().min(1),
    version: z.string().default('1.0.0'),
  }),
  spec: personaProfileSchema,
});

export type PersonaDefinition = z.infer<typeof personaDefinitionSchema>;
export type PersonaProfile = z.infer<typeof personaProfileSchema>;

export function parsePersonaDefinition(input: unknown): PersonaDefinition {
  return personaDefinitionSchema.parse(input);
}
