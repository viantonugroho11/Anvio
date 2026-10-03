import type { SkillDefinition, SkillParameter, SkillStep, SkillOutput } from '../schemas/skill.schema.js';
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
  parameters?: SkillParameter[];
  steps?: SkillStep[];
  outputs?: SkillOutput[];
  triggers?: Array<string | { event: string; condition?: string; channel?: string }>;
  composable?: boolean;
  timeout?: number;
  /** agentskills.io / Hermes vendor namespace, e.g. `metadata.hermes.tags`. */
  metadata?: Record<string, { tags?: string[] } | undefined>;
}

export interface ParseSkillMdOptions {
  /** Workspace-relative folder of a `skills/<slug>/SKILL.md` skill, so bundled `scripts/` etc. resolve. */
  baseDir?: string;
}

function collectTags(frontmatter: SkillMdFrontmatter): string[] {
  const vendorTags = Object.values(frontmatter.metadata ?? {}).flatMap((ns) =>
    Array.isArray(ns?.tags) ? ns.tags : [],
  );
  return [...new Set([...(frontmatter.tags ?? []), ...vendorTags])];
}

/** Parse agentskills.io / Hermes-style SKILL.md into Anvio SkillDefinition. */
export function parseSkillMd(
  source: string,
  slug: string,
  options: ParseSkillMdOptions = {},
): SkillDefinition {
  const { frontmatter, body } = parseFrontmatter<SkillMdFrontmatter>(source);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const name = frontmatter.name ?? titleMatch?.[1]?.trim() ?? slug;
  const instructions = options.baseDir
    ? `Skill files live in \`${options.baseDir}/\` (workspace-relative); resolve relative paths such as \`scripts/...\` against it.\n\n${body.trim()}`
    : body.trim();

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
      instructions,
      permissions: frontmatter.permissions ?? [],
      toolRequirements: frontmatter.toolRequirements ?? [],
      contextRequirements: frontmatter.contextRequirements ?? [],
      tags: collectTags(frontmatter),
      parameters: frontmatter.parameters ?? [],
      steps: frontmatter.steps ?? [],
      outputs: frontmatter.outputs ?? [],
      triggers: frontmatter.triggers ?? [],
      composable: frontmatter.composable ?? false,
      timeout: frontmatter.timeout,
    },
  });
}
