import { z } from 'zod';

export const knowledgeBaseSpecSchema = z.object({
  description: z.string().default(''),
  writable: z.boolean().default(true),
});

export const knowledgeBaseDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('KnowledgeBase'),
  metadata: z.object({
    slug: z.string().min(1),
    version: z.string().default('1.0.0'),
  }),
  spec: knowledgeBaseSpecSchema,
});

export const knowledgeManifestSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('KnowledgeManifest'),
  spec: z.object({
    bases: z.array(
      z.object({
        slug: z.string(),
        rawFiles: z.number().int().nonnegative().default(0),
        wikiFiles: z.number().int().nonnegative().default(0),
        syncedAt: z.string().optional(),
      }),
    ),
  }),
});

export type KnowledgeBaseDefinition = z.infer<typeof knowledgeBaseDefinitionSchema>;
export type KnowledgeManifest = z.infer<typeof knowledgeManifestSchema>;

export function parseKnowledgeBaseDefinition(input: unknown): KnowledgeBaseDefinition {
  return knowledgeBaseDefinitionSchema.parse(input);
}

export function parseKnowledgeManifest(input: unknown): KnowledgeManifest {
  return knowledgeManifestSchema.parse(input);
}
