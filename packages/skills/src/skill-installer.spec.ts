import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkillCatalogResolver } from './catalog-resolver.js';
import { SkillInstaller } from './skill-installer.js';

const SKILL_MD = `---
name: arxiv
description: Search arXiv papers.
version: 1.2.0
metadata:
  hermes:
    tags: [Research]
---

# arXiv
`;

describe('SkillInstaller.installFromDir', () => {
  let tmp: string;
  let installer: SkillInstaller;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-skill-install-'));
    installer = new SkillInstaller({} as SkillCatalogResolver, path.join(tmp, 'ws', 'skills'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('copies the folder with scripts and records it in the manifest', async () => {
    const src = path.join(tmp, 'arxiv');
    await fs.mkdir(path.join(src, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(src, 'SKILL.md'), SKILL_MD);
    await fs.writeFile(path.join(src, 'scripts', 'search.py'), 'print(1)\n');

    const skill = await installer.installFromDir(src);

    expect(skill.metadata.slug).toBe('arxiv');
    expect(skill.spec.tags).toEqual(['Research']);
    const copied = await fs.readFile(path.join(tmp, 'ws', 'skills', 'arxiv', 'scripts', 'search.py'), 'utf-8');
    expect(copied).toBe('print(1)\n');
    expect(await installer.listInstalled()).toMatchObject([{ slug: 'arxiv', version: '1.2.0', source: 'dir' }]);

    await installer.remove('arxiv');
    await expect(fs.stat(path.join(tmp, 'ws', 'skills', 'arxiv'))).rejects.toThrow();
    expect(await installer.listInstalled()).toEqual([]);
  });

  it('rejects a folder without SKILL.md', async () => {
    await expect(installer.installFromDir(tmp)).rejects.toThrow(/No SKILL.md/);
  });
});
