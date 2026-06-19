import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { SkillDefinition } from '@anvio/core';
import { parseSkillDefinition } from '@anvio/core';

export interface SkillDraftInput {
  slug: string;
  sessionId: string;
  agentId: string;
  topic: string;
  instructions: string;
  sourceExcerpt: string;
}

export class SkillEvolutionWriter {
  constructor(private readonly draftsDir: string) {}

  async proposeDraft(input: SkillDraftInput): Promise<{ path: string; definition: SkillDefinition }> {
    await fs.mkdir(this.draftsDir, { recursive: true });
    const slug = `${input.slug}-draft-${Date.now()}`;
    const definition = parseSkillDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Skill',
      metadata: { slug, version: '0.1.0', catalog: 'private' },
      spec: {
        name: input.topic,
        description: `Draft skill from session ${input.sessionId} (${input.agentId})`,
        instructions: `${input.instructions}\n\n## Source excerpt\n${input.sourceExcerpt}`,
        permissions: [],
        toolRequirements: [],
        contextRequirements: [],
        tags: ['draft', 'learning-loop'],
      },
    });
    const filePath = path.join(this.draftsDir, `${slug}.yaml`);
    await fs.writeFile(filePath, stringifyYaml(definition), 'utf-8');
    return { path: filePath, definition };
  }

  async listDrafts(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.draftsDir);
      return files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch {
      return [];
    }
  }

  async promoteDraft(slug: string, targetDir: string): Promise<string> {
    const src = path.join(this.draftsDir, `${slug}.yaml`);
    const dest = path.join(targetDir, `${slug.replace(/-draft-\d+$/, '')}.yaml`);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(src, dest);
    return dest;
  }
}
