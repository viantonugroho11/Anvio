import type { PersonaDefinition } from '../schemas/persona.schema.js';
import { parsePersonaDefinition } from '../schemas/persona.schema.js';
import { parseFrontmatter } from './frontmatter.js';

export interface PersonaMdFrontmatter {
  name?: string;
  description?: string;
  tone?: string;
  communicationStyle?: string;
  behavior?: string[];
  version?: string;
  memoryPreferences?: {
    retainFacts?: boolean;
    retainPreferences?: boolean;
  };
}

/** Parse Markdown persona (Hermes-profile style) into Anvio PersonaDefinition. */
export function parsePersonaMd(source: string, slug: string): PersonaDefinition {
  const { frontmatter, body } = parseFrontmatter<PersonaMdFrontmatter>(source);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const name = frontmatter.name ?? titleMatch?.[1]?.trim() ?? slug;

  return parsePersonaDefinition({
    apiVersion: 'anvio.io/v1',
    kind: 'Persona',
    metadata: {
      slug,
      version: frontmatter.version ?? '1.0.0',
    },
    spec: {
      name,
      description: frontmatter.description ?? `Persona ${slug}`,
      tone: frontmatter.tone ?? 'professional',
      behavior: frontmatter.behavior ?? [],
      communicationStyle: frontmatter.communicationStyle ?? 'clear and concise',
      memoryPreferences: frontmatter.memoryPreferences ?? {
        retainFacts: true,
        retainPreferences: true,
      },
      systemPrompt: body.trim(),
    },
  });
}
