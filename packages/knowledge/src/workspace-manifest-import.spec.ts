import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceManifestImporter } from './workspace-manifest-import.js';

describe('WorkspaceManifestImporter', () => {
  it('imports knowledge raw files and skills from workspace manifest', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-manifest-'));
    const ws = path.join(tmp, 'ws');
    const project = path.join(tmp, 'project');
    await fs.mkdir(path.join(project, 'knowledge/raw'), { recursive: true });
    await fs.mkdir(path.join(project, 'skills'), { recursive: true });
    await fs.writeFile(path.join(project, 'knowledge/raw/note.md'), '# Playbook\n');
    await fs.writeFile(path.join(project, 'skills/example-skill.md'), '# Skill\n');
    await fs.writeFile(
      path.join(project, 'workspace-manifest.json'),
      JSON.stringify({
        knowledge: [{ slug: 'playbook', rawDir: 'knowledge/raw' }],
        skills: [{ source: 'skills/example-skill.md', slug: 'example-skill' }],
      }),
    );

    const importer = new WorkspaceManifestImporter(ws);
    const result = await importer.importFromFile(path.join(project, 'workspace-manifest.json'));

    expect(result.knowledgeBases[0]?.filesCopied).toBe(1);
    expect(result.knowledgeBases[0]?.ingested).toBe(true);
    expect(result.skills[0]?.slug).toBe('example-skill');
    await expect(fs.stat(path.join(ws, 'skills/example-skill.md'))).resolves.toBeDefined();
  });
});
