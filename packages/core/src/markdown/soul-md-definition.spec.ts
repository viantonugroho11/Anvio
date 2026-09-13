import { describe, expect, it } from 'vitest';
import { parseSoulDefinitionMd } from './soul-md-definition.js';

const BODY = `# Tech Lead Soul

## Identity
- Name: Tech Lead Soul
- Role: Senior Technical Lead

## Values
- delivery
`;

describe('parseSoulDefinitionMd', () => {
  it('keeps the permissive defaults when no frontmatter is present', () => {
    const soul = parseSoulDefinitionMd(BODY, 'tech-lead-soul');
    expect(soul.spec.evolution.allowAutoUpdate).toBe(true);
    expect(soul.spec.evolution.requireApproval).toBe(false);
    // Schema default — capture only on an explicit /capture (issue #64).
    expect(soul.spec.evolution.captureOn).toBe('mention');
  });

  it('honors an evolution policy set in frontmatter (issue #64)', () => {
    const soul = parseSoulDefinitionMd(
      `---
evolution:
  allowAutoUpdate: false
  requireApproval: true
  captureOn: manual
---

${BODY}`,
      'tech-lead-soul',
    );

    expect(soul.spec.evolution.allowAutoUpdate).toBe(false);
    expect(soul.spec.evolution.requireApproval).toBe(true);
    expect(soul.spec.evolution.captureOn).toBe('manual');
  });

  it('parses the identity body when frontmatter is present', () => {
    const soul = parseSoulDefinitionMd(
      `---
evolution:
  captureOn: always
---

${BODY}`,
      'tech-lead-soul',
    );

    expect(soul.spec.name).toBe('Tech Lead Soul');
    expect(soul.spec.identity.role).toBe('Senior Technical Lead');
    expect(soul.spec.values).toEqual(['delivery']);
    expect(soul.spec.evolution.captureOn).toBe('always');
  });
});
