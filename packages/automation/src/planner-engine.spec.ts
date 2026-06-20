import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { PlanExecuteReviewEngine } from './planner-engine.js';

describe('PlanExecuteReviewEngine', () => {
  it('loads plan-execute-review config from repo', async () => {
    const configPath = path.join(process.cwd(), 'configs/planner/plan-execute-review.yaml');
    const engine = await PlanExecuteReviewEngine.load(configPath);
    expect(engine.phases.map((p) => p.name)).toEqual(['plan', 'execute', 'review']);
  });

  it('runs phases sequentially with prior context', async () => {
    const configPath = path.join(process.cwd(), 'configs/planner/plan-execute-review.yaml');
    const engine = await PlanExecuteReviewEngine.load(configPath);
    const prompts: string[] = [];
    const results = await engine.run(
      {
        runAgent: async (_agentId, prompt) => {
          prompts.push(prompt);
          return `output-${prompts.length}`;
        },
      },
      { task: 'Build feature X' },
    );
    expect(results).toHaveLength(3);
    expect(results[0]?.output).toBe('output-1');
    expect(results[2]?.phase).toBe('review');
    expect(prompts[2]).toContain('[execute]');
  });
});
