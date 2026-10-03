import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkillCatalogResolver } from './catalog-resolver.js';
import { findSkillDirs, importSkills, isGitSource } from './skill-import.js';
import { SkillInstaller } from './skill-installer.js';

const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`;

async function writeSkill(dir: string, name: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), skillMd(name));
}

describe('importSkills', () => {
  let tmp: string;
  let installer: SkillInstaller;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-skill-import-spec-'));
    installer = new SkillInstaller({} as SkillCatalogResolver, path.join(tmp, 'ws', 'skills'));
    // Hermes-like layout: skills/<category>/<skill>/SKILL.md
    await writeSkill(path.join(tmp, 'src', 'skills', 'research', 'arxiv'), 'arxiv');
    await writeSkill(path.join(tmp, 'src', 'skills', 'research', 'news'), 'news');
    await writeSkill(path.join(tmp, 'src', 'skills', 'devops', 'k8s'), 'k8s');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('detects git sources', () => {
    expect(isGitSource('https://github.com/nousresearch/hermes-agent')).toBe(true);
    expect(isGitSource('git@github.com:a/b.git')).toBe(true);
    expect(isGitSource('./skills/arxiv')).toBe(false);
  });

  it('finds nested skill folders', async () => {
    const dirs = await findSkillDirs(path.join(tmp, 'src'));
    expect(dirs.map((d) => path.basename(d))).toEqual(['k8s', 'arxiv', 'news']);
  });

  it('imports a single skill folder with a custom slug', async () => {
    const [skill] = await importSkills(installer, path.join(tmp, 'src', 'skills', 'research', 'arxiv'), {
      slug: 'papers',
    });
    expect(skill?.metadata.slug).toBe('papers');
    await expect(fs.stat(path.join(tmp, 'ws', 'skills', 'papers', 'SKILL.md'))).resolves.toBeTruthy();
  });

  it('imports a category from a git source via --path and cleans up the clone', async () => {
    let cloneDir = '';
    const skills = await importSkills(installer, 'https://example.com/hermes.git', {
      subPath: 'skills/research',
      cloneImpl: async (_url, dest) => {
        cloneDir = dest;
        await fs.cp(path.join(tmp, 'src'), dest, { recursive: true });
      },
    });
    expect(skills.map((s) => s.metadata.slug)).toEqual(['arxiv', 'news']);
    await expect(fs.stat(cloneDir)).rejects.toThrow();
  });

  it('rejects --name with multiple skills and paths escaping the source', async () => {
    await expect(importSkills(installer, path.join(tmp, 'src'), { slug: 'x' })).rejects.toThrow(/single skill/);
    await expect(importSkills(installer, path.join(tmp, 'src'), { subPath: '../..' })).rejects.toThrow(/escapes/);
  });
});
