import type { SkillDefinition } from '../schemas/skill.schema.js';
import { parseSkillDefinition } from '../schemas/skill.schema.js';
import { parseFrontmatter } from './frontmatter.js';

export interface SkillMdFrontmatter {
  name?: string;
  description?: string;
  permissions?: string[];
  toolRequirements?: string[];
  contextRequirements?: string[];
  tags?: string[];
  catalog?: 'bundled' | 'community' | 'team' | 'private';
  version?: string;
}

/** Parse agentskills.io / Hermes-style SKILL.md into Anvio SkillDefinition. */
export function parseSkillMd(source: string, slug: string): SkillDefinition {
  const { frontmatter, body } = parseFrontmatter<SkillMdFrontmatter>(source);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const name = frontmatter.name ?? titleMatch?.[1]?.trim() ?? slug;

  return parseSkillDefinition({
    apiVersion: 'anvio.io/v1',
    kind: 'Skill',
    metadata: {
      slug,
      version: frontmatter.version ?? '1.0.0',
      catalog: frontmatter.catalog ?? 'private',
    },
    spec: {
      name,
      description: frontmatter.description ?? `Skill ${slug}`,
      instructions: body.trim(),
      permissions: frontmatter.permissions ?? [],
      toolRequirements: frontmatter.toolRequirements ?? [],
      contextRequirements: frontmatter.contextRequirements ?? [],
      tags: frontmatter.tags ?? [],
    },
  });
}
