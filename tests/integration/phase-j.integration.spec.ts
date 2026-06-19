import { describe, expect, it } from 'vitest';
import { parseAgentMd, parseSkillMd, parseSoulDefinitionMd, parseWorkflowMd } from '@anvio/core';
import { Workspace } from '@anvio/workspace';
import { createSoulService } from '@anvio/souls';
import { createMemoryProvider } from '@anvio/memory';
import { FilesystemStorageProvider } from '@anvio/storage';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const AGENT_MD = `---
persona: architect
skills:
  - architecture
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
description: Senior Software Architect
soul: architect-soul
---
# Architect
`;

const SKILL_MD = `---
name: Architecture
description: System design and review
---
Review with tradeoffs.
`;

const SOUL_MD = `# Architect Soul

## Identity
- Name: Architect Soul
- Role: Senior Software Architect

## Values
- simplicity
- maintainability
`;

const WORKFLOW_MD = `---
apiVersion: anvio.io/v1
kind: Workflow
metadata:
  slug: example-dag
spec:
  description: Test
  nodes:
    - id: a
      type: transform
      template: ok
  outputs:
    summary:
      from: nodes.a.output
---
# Example
`;

describe('Phase J — MD-first workspace artifacts', () => {
  it('loads agent skill soul workflow from markdown', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-j-'));
    await Workspace.init(tmp);
    await fs.writeFile(path.join(tmp, 'agents/architect.md'), AGENT_MD, 'utf-8');
    await fs.writeFile(path.join(tmp, 'skills/architecture.md'), SKILL_MD, 'utf-8');
    await fs.mkdir(path.join(tmp, 'souls/architect-soul'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'souls/architect-soul/SOUL.md'), SOUL_MD, 'utf-8');
    await fs.writeFile(path.join(tmp, 'workflows/example-dag.md'), WORKFLOW_MD, 'utf-8');

    const ws = await Workspace.open(tmp);
    const agent = await ws.loader.loadAgent('architect');
    expect(agent.spec.skills).toContain('architecture');
    const skill = await ws.loader.loadSkill('architecture');
    expect(skill.spec.name).toBe('Architecture');
    const soul = parseSoulDefinitionMd(SOUL_MD, 'architect-soul');
    expect(soul.spec.values).toContain('simplicity');
    const wf = parseWorkflowMd(WORKFLOW_MD);
    expect(wf.metadata.slug).toBe('example-dag');
  });

  it('soul service reads SOUL.md from folder', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-j-soul-'));
    const storage = new FilesystemStorageProvider(tmp);
    await fs.mkdir(path.join(tmp, 'souls/architect-soul'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'souls/architect-soul/SOUL.md'), SOUL_MD, 'utf-8');
    const memory = createMemoryProvider('filesystem', storage);
    const souls = createSoulService(storage, memory);
    const def = await souls.get('architect-soul');
    expect(def.spec.name).toBe('Architect Soul');
  });

  it('parseAgentMd and parseSkillMd round-trip frontmatter', () => {
    const agent = parseAgentMd(AGENT_MD, 'architect');
    expect(agent.metadata.name).toBe('architect');
    const skill = parseSkillMd(SKILL_MD, 'test-skill');
    expect(skill.spec.instructions).toContain('Review with tradeoffs');
  });
});
