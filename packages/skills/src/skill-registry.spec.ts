import { describe, expect, it } from 'vitest';
import type { ConfigLoader } from '@anvio/core';
import { SkillRegistry } from './index.js';

function loaderThrowing(error: Error): ConfigLoader {
  return { loadSkill: async () => Promise.reject(error) } as unknown as ConfigLoader;
}

describe('SkillRegistry.getBySlugs', () => {
  it('reports a missing skill as not found', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    await expect(
      new SkillRegistry(loaderThrowing(enoent)).getBySlugs(['ghost']),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Skill not found: ghost',
    });
  });

  it('keeps the parse error for a skill that exists but is invalid', async () => {
    const registry = new SkillRegistry(
      loaderThrowing(new Error('Flow sequence in block collection must be closed')),
    );
    await expect(registry.getBySlugs(['broken'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('Skill broken is invalid: Flow sequence'),
    });
  });
});
