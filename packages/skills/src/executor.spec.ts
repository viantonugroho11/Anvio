import type { BuiltinToolCall, RuntimeToolPort, SkillDefinition } from '@anvio/core';
import { describe, expect, it } from 'vitest';
import { executeSkill, MAX_SKILL_DEPTH, SkillStepError } from './executor.js';

function skill(
  slug: string,
  steps: SkillDefinition['spec']['steps'],
  parameters: SkillDefinition['spec']['parameters'] = [],
): SkillDefinition {
  return {
    apiVersion: 'anvio.io/v1',
    kind: 'Skill',
    metadata: { slug, version: '1.0.0' },
    spec: {
      name: slug,
      description: slug,
      instructions: slug,
      permissions: [],
      toolRequirements: [],
      contextRequirements: [],
      tags: [],
      parameters,
      steps,
      outputs: [],
      triggers: [],
      composable: true,
    },
  };
}

function step(
  id: string,
  extra: Partial<SkillDefinition['spec']['steps'][number]>,
): SkillDefinition['spec']['steps'][number] {
  return { id, action: id, onError: 'fail', maxRetries: 0, ...extra };
}

function recordingPort(): RuntimeToolPort & { calls: BuiltinToolCall[] } {
  const calls: BuiltinToolCall[] = [];
  return {
    calls,
    listTools: () => ['anvio_tools__echo'],
    getToolInstructions: () => '',
    async call(call) {
      calls.push(call);
      return { name: call.name, output: call.arguments, status: 'completed' };
    },
  };
}

const ctx = { sessionId: 's', agentId: 'a', userId: 'u' };

describe('executeSkill conditions', () => {
  it('runs steps whose condition holds and skips the others', async () => {
    const port = recordingPort();
    const def = skill(
      'review',
      [
        step('sec', { tool: 'echo', condition: "focus == 'security' || focus == 'all'" }),
        step('perf', { tool: 'echo', condition: "focus == 'performance'" }),
      ],
      [{ name: 'focus', type: 'string', required: true }],
    );
    const result = await executeSkill({
      skill: def,
      params: { focus: 'security' },
      toolPort: port,
      ctx,
    });
    expect(result.steps.map((s) => [s.id, s.status])).toEqual([
      ['sec', 'ok'],
      ['perf', 'skipped'],
    ]);
  });

  it('rejects a skill with an invalid condition before running any step', async () => {
    const port = recordingPort();
    const def = skill('bad', [
      step('one', { tool: 'echo' }),
      step('two', { tool: 'echo', condition: 'a = 1' }),
    ]);
    await expect(executeSkill({ skill: def, toolPort: port, ctx })).rejects.toMatchObject({
      code: 'INVALID_CONDITION',
    });
    expect(port.calls).toHaveLength(0);
  });

  it('cannot read host globals from a condition', async () => {
    const port = recordingPort();
    const def = skill('exfil', [step('one', { tool: 'echo', condition: 'process.env.HOME' })]);
    const result = await executeSkill({ skill: def, toolPort: port, ctx });
    expect(result.steps[0]!.status).toBe('skipped');
    expect(port.calls).toHaveLength(0);
  });
});

describe('executeSkill recursion guard', () => {
  it('detects A → B → A cycles through composable steps', async () => {
    const skills: Record<string, SkillDefinition> = {
      a: skill('a', [step('call-b', { tool: 'skill:b' })]),
      b: skill('b', [step('call-a', { tool: 'skill:a' })]),
    };
    await expect(
      executeSkill({ skill: skills.a!, ctx, resolveSkill: async (slug) => skills[slug] ?? null }),
    ).rejects.toThrow(/Skill cycle detected: a → b → a/);
  });

  it('caps nesting depth', async () => {
    const chain: Record<string, SkillDefinition> = {};
    for (let i = 0; i <= MAX_SKILL_DEPTH + 1; i++) {
      chain[`s${i}`] = skill(`s${i}`, [step('next', { tool: `skill:s${i + 1}` })]);
    }
    chain[`s${MAX_SKILL_DEPTH + 2}`] = skill(`s${MAX_SKILL_DEPTH + 2}`, []);
    await expect(
      executeSkill({ skill: chain.s0!, ctx, resolveSkill: async (slug) => chain[slug] ?? null }),
    ).rejects.toThrow(/deeper than 8/);
  });

  it('allows the same skill in sibling (non-nested) calls', async () => {
    const leaf = skill('leaf', []);
    await executeSkill({ skill: leaf, ctx });
    await expect(executeSkill({ skill: leaf, ctx })).resolves.toBeDefined();
  });

  it('exposes the cycle error type', () => {
    expect(new SkillStepError('SKILL_CYCLE', 'x').code).toBe('SKILL_CYCLE');
  });
});
