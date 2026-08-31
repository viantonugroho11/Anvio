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
  description?: string;
  tags?: string[];
  /** Chat channel this session ran on (e.g. 'telegram'). Optional; recorded verbatim in the draft's frontmatter for lineage. */
  sourceChannel?: string;
  /** User id who triggered the session. */
  sourceUserId?: string;
  /** Message count captured from the session for context. */
  sourceMessages?: number;
}

interface DraftLineage {
  sourceSessionId: string;
  sourceAgentId: string;
  sourceChannel?: string;
  sourceUserId?: string;
  sourceMessages?: number;
  capturedAt: string;
  sourceExcerpt: string;
}

export class SkillEvolutionWriter {
  constructor(private readonly draftsDir: string) {}

  async proposeDraft(input: SkillDraftInput): Promise<{ path: string; definition: SkillDefinition }> {
    await fs.mkdir(this.draftsDir, { recursive: true });
    // Slug carries the session id (short) alongside the timestamp so a
    // reviewer can grep a draft back to the run it came from. The old
    // `-draft-${Date.now()}` was unique but opaque (issue #56 (c)).
    const sessionShort = input.sessionId.slice(0, 8) || 'nosession';
    const slug = `${input.slug}-${sessionShort}-${Date.now()}`;
    const lineage: DraftLineage = {
      sourceSessionId: input.sessionId,
      sourceAgentId: input.agentId,
      sourceChannel: input.sourceChannel,
      sourceUserId: input.sourceUserId,
      sourceMessages: input.sourceMessages,
      capturedAt: new Date().toISOString(),
      sourceExcerpt: input.sourceExcerpt,
    };
    const definition = parseSkillDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Skill',
      metadata: { slug, version: '0.1.0', catalog: 'private' },
      spec: {
        name: input.topic,
        description: input.description ?? `Draft skill from session ${input.sessionId} (${input.agentId})`,
        instructions: `${input.instructions}\n\n## Source excerpt\n${input.sourceExcerpt}`,
        permissions: [],
        toolRequirements: [],
        contextRequirements: [],
        tags: input.tags ?? ['draft', 'learning-loop'],
      },
    });
    const filePath = path.join(this.draftsDir, `${slug}.md`);
    const md = renderSkillMd(definition, lineage);
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
        // Strip extension first, then either the legacy `-draft-<ms>` or
        // the current `-<sessionShort>-<ms>` suffix so promotion recovers
        // the canonical slug (e.g. `tech-lead-abc12345-1735...` → `tech-lead`).
        const base = path
          .basename(name)
          .replace(/\.(md|ya?ml)$/, '')
          .replace(/-[0-9a-z]{4,8}-\d+$/i, '')
          .replace(/-draft-\d+$/, '');
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

function renderSkillMd(definition: SkillDefinition, lineage?: DraftLineage): string {
  const { spec, metadata } = definition;
  const lines: string[] = [
    '---',
    `name: ${spec.name}`,
    `description: ${spec.description}`,
    `catalog: ${metadata.catalog ?? 'private'}`,
    `version: ${metadata.version}`,
    `tags: [${(spec.tags ?? []).map((t) => `"${t}"`).join(', ')}]`,
  ];
  if (lineage) {
    // Lineage back to the session that produced this draft (issue #56 (d)).
    // Kept under a nested `source:` key so it survives round-trips through
    // the skill parser (which ignores unknown top-level keys) and stays
    // grepable for reviewers.
    lines.push('source:');
    lines.push(`  sessionId: ${lineage.sourceSessionId}`);
    lines.push(`  agentId: ${lineage.sourceAgentId}`);
    if (lineage.sourceChannel) lines.push(`  channel: ${lineage.sourceChannel}`);
    if (lineage.sourceUserId) lines.push(`  userId: ${lineage.sourceUserId}`);
    if (lineage.sourceMessages !== undefined) {
      lines.push(`  messages: ${lineage.sourceMessages}`);
    }
    lines.push(`  capturedAt: ${lineage.capturedAt}`);
  }
  if (spec.parameters.length > 0) {
    lines.push('parameters:');
    for (const p of spec.parameters) {
      lines.push(`  - name: ${p.name}`);
      lines.push(`    type: ${p.type}`);
      if (p.description) lines.push(`    description: ${p.description}`);
      lines.push(`    required: ${p.required}`);
      if (p.default !== undefined) lines.push(`    default: ${JSON.stringify(p.default)}`);
    }
  }
  if (spec.steps.length > 0) {
    lines.push('steps:');
    for (const s of spec.steps) {
      lines.push(`  - id: ${s.id}`);
      lines.push(`    action: ${s.action}`);
      if (s.tool) lines.push(`    tool: ${s.tool}`);
      if (s.condition) lines.push(`    condition: ${s.condition}`);
      if (s.output) lines.push(`    output: ${s.output}`);
    }
  }
  if (spec.outputs.length > 0) {
    lines.push('outputs:');
    for (const o of spec.outputs) {
      lines.push(`  - name: ${o.name}`);
      lines.push(`    type: ${o.type}`);
      if (o.description) lines.push(`    description: ${o.description}`);
    }
  }
  lines.push('---', '', spec.instructions, '');
  return lines.join('\n');
}
