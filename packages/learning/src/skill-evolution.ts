import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
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
    const filePath = path.join(this.draftsDir, `${slug}.md`);
    const md = renderSkillMd(definition);
    await fs.writeFile(filePath, md, 'utf-8');
    return { path: filePath, definition };
  }

  async listDrafts(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.draftsDir);
      return files.filter((f) => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch {
      return [];
    }
  }

  async promoteDraft(slug: string, targetDir: string): Promise<string> {
    const candidates = [
      slug,
      `${slug}.md`,
      `${slug}.yaml`,
      `${slug}.yml`,
    ];
    for (const name of candidates) {
      const src = path.join(this.draftsDir, name);
      try {
        await fs.access(src);
        const base = path.basename(name).replace(/-draft-\d+/, '').replace(/\.(md|ya?ml)$/, '');
        const dest = path.join(targetDir, `${base}.md`);
        await fs.mkdir(targetDir, { recursive: true });
        const raw = await fs.readFile(src, 'utf-8');
        if (name.endsWith('.md')) {
          await fs.writeFile(dest, raw, 'utf-8');
        } else {
          const def = parseSkillDefinition(parseYaml(raw));
          await fs.writeFile(dest, renderSkillMd(def), 'utf-8');
        }
        return dest;
      } catch {
        // try next candidate
      }
    }
    throw new Error(`Draft not found: ${slug}`);
  }
}

function renderSkillMd(definition: SkillDefinition): string {
  const { spec, metadata } = definition;
  return `---
name: ${spec.name}
description: ${spec.description}
catalog: ${metadata.catalog ?? 'private'}
version: ${metadata.version}
tags: [${(spec.tags ?? []).map((t) => `"${t}"`).join(', ')}]
---

${spec.instructions}
`;
}
