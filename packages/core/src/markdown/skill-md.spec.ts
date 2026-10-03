import { describe, expect, it } from 'vitest';
import { parseSkillMd } from './skill-md.js';

// Frontmatter shape taken from Hermes Agent `skills/research/arxiv/SKILL.md` (MIT).
const HERMES_SKILL = `---
name: arxiv
description: "Search arXiv papers by keyword, author, category, or ID."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, Arxiv]
    related_skills: [pdf]
---

# arXiv Research

Run \`scripts/search_arxiv.py\` to query the API.
`;

describe('parseSkillMd', () => {
  it('parses a Hermes / agentskills.io SKILL.md and keeps vendor tags', () => {
    const skill = parseSkillMd(HERMES_SKILL, 'arxiv');
    expect(skill.spec.name).toBe('arxiv');
    expect(skill.metadata.version).toBe('1.0.0');
    expect(skill.spec.tags).toEqual(['Research', 'Arxiv']);
    expect(skill.spec.instructions).toMatch(/^# arXiv Research/);
  });

  it('merges top-level tags with vendor tags without duplicates', () => {
    const md = HERMES_SKILL.replace('license: MIT', 'license: MIT\ntags: [Research, papers]');
    expect(parseSkillMd(md, 'arxiv').spec.tags).toEqual(['Research', 'papers', 'Arxiv']);
  });

  it('prefixes instructions with the skill folder when baseDir is given', () => {
    const skill = parseSkillMd(HERMES_SKILL, 'arxiv', { baseDir: 'skills/arxiv' });
    expect(skill.spec.instructions).toContain('`skills/arxiv/`');
    expect(skill.spec.instructions).toContain('# arXiv Research');
  });
});
