import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SlaudeManifestImporter } from './slaude-import.js';

describe('SlaudeManifestImporter', () => {
  it('imports knowledge raw files and skills from slaude.json', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-slaude-'));
    const project = path.join(tmp, 'project');
    await fs.mkdir(path.join(project, 'knowledge/raw'), { recursive: true });
    await fs.mkdir(path.join(project, 'skills'), { recursive: true });
    await fs.writeFile(path.join(project, 'knowledge/raw/note.md'), '# Playbook\n\nAlways test.', 'utf-8');
    await fs.writeFile(path.join(project, 'skills/review.md'), '# Review skill\n\nReview carefully.', 'utf-8');
    await fs.writeFile(
      path.join(project, 'slaude.json'),
      JSON.stringify({
        knowledge: [{ slug: 'playbook', rawDir: 'knowledge/raw' }],
        skills: [{ source: 'skills/review.md', slug: 'review' }],
      }),
      'utf-8',
    );

    const ws = path.join(tmp, 'workspace');
    await fs.mkdir(ws, { recursive: true });
    const importer = new SlaudeManifestImporter(ws);
    const result = await importer.importFromFile(path.join(project, 'slaude.json'));

    expect(result.knowledgeBases[0]?.filesCopied).toBe(1);
    expect(result.skills[0]?.slug).toBe('review');
    const skill = await fs.readFile(path.join(ws, 'skills/review.md'), 'utf-8');
    expect(skill).toContain('Review skill');
  });
});
