import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SkillTriggerCache } from './trigger-index.js';

async function writeSkill(dir: string, slug: string, triggers: string[]): Promise<string> {
  const p = path.join(dir, `${slug}.yaml`);
  await fs.writeFile(
    p,
    `apiVersion: anvio.io/v1
kind: Skill
metadata:
  slug: ${slug}
  version: 1.0.0
spec:
  name: ${slug}
  description: test skill
  instructions: do the thing
  triggers:
${triggers.map((t) => `    - "${t}"`).join('\n')}
  steps: []
`,
    'utf-8',
  );
  return p;
}

describe('SkillTriggerCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-triggers-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('matches skills by trigger keyword', async () => {
    await writeSkill(dir, 'greet', ['hello']);
    await writeSkill(dir, 'weather', ['forecast']);
    const cache = new SkillTriggerCache({ bundledDir: dir, workspaceDir: dir + '__none' });
    const slugs = await cache.matchAll('please say hello');
    expect(slugs).toEqual(['greet']);
    expect(cache.size).toBe(2);
  });

  it('re-parses only files whose mtime changed', async () => {
    const filePath = await writeSkill(dir, 'a', ['x']);
    const cache = new SkillTriggerCache({ bundledDir: dir, workspaceDir: dir + '__none' });
    await cache.refresh();
    expect(cache.size).toBe(1);

    // Bump mtime + change trigger
    await new Promise((r) => setTimeout(r, 20));
    await fs.utimes(filePath, new Date(), new Date());
    await fs.writeFile(
      filePath,
      `apiVersion: anvio.io/v1
kind: Skill
metadata: { slug: a, version: 1.0.0 }
spec:
  name: a
  description: t
  instructions: do it
  triggers: ["y"]
  steps: []
`,
      'utf-8',
    );
    await cache.refresh();
    expect(await cache.matchAll('y here')).toEqual(['a']);
    expect(await cache.matchAll('x here')).toEqual([]);
  });

  it('drops entries whose files were deleted', async () => {
    const filePath = await writeSkill(dir, 'goner', ['t']);
    const cache = new SkillTriggerCache({ bundledDir: dir, workspaceDir: dir + '__none' });
    await cache.refresh();
    expect(cache.size).toBe(1);
    await fs.unlink(filePath);
    await cache.refresh();
    expect(cache.size).toBe(0);
  });

  it('workspace file wins over bundled for the same slug', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-triggers-ws-'));
    try {
      await writeSkill(dir, 'shared', ['bundled-trigger']);
      await writeSkill(workspaceDir, 'shared', ['workspace-trigger']);
      const cache = new SkillTriggerCache({ bundledDir: dir, workspaceDir });
      const slugsA = await cache.matchAll('workspace-trigger here');
      expect(slugsA).toEqual(['shared']);
      const slugsB = await cache.matchAll('bundled-trigger here');
      expect(slugsB).toEqual([]);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('two successive matchAll calls do not re-read unchanged files', async () => {
    const filePath = await writeSkill(dir, 'stable', ['x']);
    const cache = new SkillTriggerCache({ bundledDir: dir, workspaceDir: dir + '__none' });
    await cache.matchAll('x');
    const spyPath = filePath;
    let reads = 0;
    const originalReadFile = fs.readFile;
    (fs as unknown as { readFile: typeof fs.readFile }).readFile = (async (p: string, ...rest: unknown[]) => {
      if (p === spyPath) reads++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalReadFile(p as any, ...(rest as [any]));
    }) as typeof fs.readFile;
    try {
      await cache.matchAll('x again');
      await cache.matchAll('x again');
    } finally {
      (fs as unknown as { readFile: typeof fs.readFile }).readFile = originalReadFile;
    }
    expect(reads).toBe(0);
  });

  it('skips manifest.yaml and files starting with _', async () => {
    await fs.writeFile(path.join(dir, 'manifest.yaml'), 'noop: true', 'utf-8');
    await fs.writeFile(path.join(dir, '_draft.yaml'), 'noop: true', 'utf-8');
    await writeSkill(dir, 'real', ['t']);
    const cache = new SkillTriggerCache({ bundledDir: dir, workspaceDir: dir + '__none' });
    await cache.refresh();
    expect(cache.size).toBe(1);
  });
});
