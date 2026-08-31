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

  /**
   * Read a single draft by slug (with or without extension). Returns the
   * raw file contents so the caller can render frontmatter and body as it
   * likes — a chat surface prints markdown, the CLI pipes to less.
   */
  async getDraft(slug: string): Promise<{ path: string; content: string } | null> {
    for (const name of this.candidates(slug)) {
      const p = path.join(this.draftsDir, name);
      try {
        const content = await fs.readFile(p, 'utf-8');
        return { path: p, content };
      } catch {
        /* try next */
      }
    }
    return null;
  }

  /**
   * Soft-delete: move the draft to `_drafts/_discarded/` rather than
   * unlinking, so an accidental `/discard` is recoverable. The subfolder
   * is excluded from `listDrafts()` by extension filter — no additional
   * bookkeeping required.
   */
  async discardDraft(slug: string): Promise<{ path: string } | null> {
    for (const name of this.candidates(slug)) {
      const src = path.join(this.draftsDir, name);
      try {
        await fs.access(src);
        const trash = path.join(this.draftsDir, '_discarded');
        await fs.mkdir(trash, { recursive: true });
        const dest = path.join(trash, name);
        await fs.rename(src, dest);
        return { path: dest };
      } catch {
        /* try next */
      }
    }
    return null;
  }

  /**
   * Remove drafts older than `olderThanMs`. Called by
   * `anvio learning drafts prune`. Returns the removed file paths so a
   * caller can echo them.
   */
  async pruneDrafts(olderThanMs: number, now: number = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    let entries: string[];
    try {
      entries = await fs.readdir(this.draftsDir);
    } catch {
      return removed;
    }
    for (const name of entries) {
      if (!name.endsWith('.md') && !name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
      const filePath = path.join(this.draftsDir, name);
      try {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > olderThanMs) {
          await fs.unlink(filePath);
          removed.push(filePath);
        }
      } catch {
        /* skip */
      }
    }
    return removed;
  }

  private candidates(slug: string): string[] {
    return [slug, `${slug}.md`, `${slug}.yaml`, `${slug}.yml`];
  }

  async promoteDraft(
    slug: string,
    targetDir: string,
    options: { force?: boolean } = {},
  ): Promise<{ path: string; alreadyExisted: boolean; diff?: string }> {
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
        const rendered = name.endsWith('.md')
          ? raw
          : renderSkillMd(parseSkillDefinition(parseYaml(raw)));

        // Diff-mode guard: refuse to overwrite an existing skill unless
        // the caller passed `force: true`. Return the diff so the caller
        // can surface it (issue #56, nice-to-have).
        let existingContent: string | null = null;
        try {
          existingContent = await fs.readFile(dest, 'utf-8');
        } catch {
          existingContent = null;
        }
        if (existingContent !== null && existingContent !== rendered && !options.force) {
          return {
            path: dest,
            alreadyExisted: true,
            diff: unifiedDiff(existingContent, rendered),
          };
        }
        await fs.writeFile(dest, rendered, 'utf-8');
        return { path: dest, alreadyExisted: existingContent !== null };
      } catch {
        // try next candidate
      }
    }
    throw new Error(`Draft not found: ${slug}`);
  }
}

/**
 * Small line-oriented diff for the "existing skill would change" case in
 * promoteDraft. Not a full unified-diff implementation — no hunk context,
 * no color — just enough for a chat surface or terminal to show the
 * reviewer what would change before they re-run with --force.
 */
function unifiedDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) continue;
    if (a !== undefined) lines.push(`- ${a}`);
    if (b !== undefined) lines.push(`+ ${b}`);
  }
  return lines.join('\n');
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
