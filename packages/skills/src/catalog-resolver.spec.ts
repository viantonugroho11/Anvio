import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillCatalogResolver } from './catalog-resolver.js';

const SKILL = (slug: string) => `apiVersion: anvio.io/v1
kind: Skill
metadata:
  slug: ${slug}
spec:
  name: ${slug}
  description: test skill
  instructions: do the thing
`;

describe('SkillCatalogResolver.loadAll cache (EVO-008)', () => {
  it('caches catalog loads within the TTL and refreshes after invalidate', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-skills-'));
    const dir = path.join(tmp, 'skills');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'alpha.yaml'), SKILL('alpha'));

    const resolver = new SkillCatalogResolver({ bundledDir: dir, workspaceDir: dir });
    const first = await resolver.loadAll();
    expect(first.map((s) => s.metadata.slug)).toEqual(['alpha']);

    // new file added — cached result still served inside TTL
    await fs.writeFile(path.join(dir, 'beta.yaml'), SKILL('beta'));
    const cached = await resolver.loadAll();
    expect(cached).toHaveLength(1);

    resolver.invalidateCache();
    const refreshed = await resolver.loadAll();
    expect(refreshed.map((s) => s.metadata.slug).sort()).toEqual(['alpha', 'beta']);

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
