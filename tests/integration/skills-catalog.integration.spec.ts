import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { parseSkillDefinition } from '@anvio/core';
import { createSkillCatalogResolver, createSkillInstaller } from '@anvio/skills';
import { Workspace } from '@anvio/workspace';

describe('Skills Catalog', () => {
  let tmpDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-skills-'));
    await Workspace.init(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('lists at least 11 bundled skills', async () => {
    const catalog = createSkillCatalogResolver(tmpDir, repoRoot);
    const bundled = await catalog.listBundled();
    expect(bundled.length).toBeGreaterThanOrEqual(11);
  });

  it('validates all bundled skills', async () => {
    const catalog = createSkillCatalogResolver(tmpDir, repoRoot);
    for (const slug of await catalog.listBundled()) {
      const skill = await catalog.load(slug);
      expect(skill.metadata.slug).toBe(slug);
      expect(skill.spec.instructions.length).toBeGreaterThan(0);
    }
  });

  it('installs bundled skill to workspace', async () => {
    const catalog = createSkillCatalogResolver(tmpDir, repoRoot);
    const installer = createSkillInstaller(catalog, tmpDir);
    const installed = await installer.install('coding');

    expect(installed.metadata.slug).toBe('coding');
    const raw = await fs.readFile(path.join(tmpDir, 'skills/coding.yaml'), 'utf8');
    expect(raw).toContain('Coding');
  });

  it('workspace override wins over bundled', async () => {
    const catalog = createSkillCatalogResolver(tmpDir, repoRoot);
    await fs.mkdir(path.join(tmpDir, 'skills'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'skills/architecture.yaml'),
      `apiVersion: anvio.io/v1
kind: Skill
metadata:
  slug: architecture
  version: "9.9.9"
spec:
  name: Custom Architecture
  description: Workspace override
  instructions: Custom instructions
  permissions: []
  toolRequirements: []
  contextRequirements: []`,
      'utf8',
    );

    const skill = await catalog.load('architecture');
    expect(skill.metadata.version).toBe('9.9.9');
    expect(skill.spec.name).toBe('Custom Architecture');
  });
});
