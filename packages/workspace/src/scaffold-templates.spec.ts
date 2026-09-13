import { describe, expect, it } from 'vitest';
import { parseSoulDefinitionMd, parseSkillMd } from '@anvio/core';
import { scaffoldTemplate } from './mutations.js';

/**
 * Scaffolded primitives have to load. The soul template shipped
 * `captureOn: never` — not a member of the enum — so every soul created by
 * the CLI failed validation on load (issue #65). Round-trip each template
 * through the parser that will actually read it.
 */
describe('scaffold templates round-trip through their parsers', () => {
  it('soul template parses, and its captureOn is a valid enum member', () => {
    const md = scaffoldTemplate('soul', 'my-soul', 'tester');
    const soul = parseSoulDefinitionMd(md, 'my-soul');
    expect(soul.spec.evolution.allowAutoUpdate).toBe(false);
    expect(['always', 'mention', 'manual']).toContain(soul.spec.evolution.captureOn);
  });

  it('skill template parses', () => {
    const md = scaffoldTemplate('skill', 'my-skill', 'tester');
    expect(() => parseSkillMd(md, 'my-skill')).not.toThrow();
  });
});
