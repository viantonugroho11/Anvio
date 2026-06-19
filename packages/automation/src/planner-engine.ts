import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface PlannerPhase {
  name: 'plan' | 'execute' | 'review';
  agent: string;
  prompt: string;
}

export interface PlannerConfig {
  apiVersion: 'anvio.io/v1';
  kind: 'Planner';
  metadata: { name: string; description?: string };
  spec: {
    phases: PlannerPhase[];
    requireReviewApproval: boolean;
  };
}

export interface PlannerRunInput {
  task: string;
  context?: string;
}

export interface PlannerPhaseResult {
  phase: PlannerPhase['name'];
  agent: string;
  output: string;
}

export interface PlannerRunner {
  runAgent(agentId: string, prompt: string): Promise<string>;
}

/** Hermes-tech style PLAN → EXECUTE → REVIEW orchestration. */
export class PlanExecuteReviewEngine {
  constructor(private readonly config: PlannerConfig) {}

  static async load(configPath: string): Promise<PlanExecuteReviewEngine> {
    const raw = parseYaml(await fs.readFile(configPath, 'utf-8')) as PlannerConfig;
    if (raw.kind !== 'Planner' || !raw.spec?.phases?.length) {
      throw new Error(`Invalid planner config: ${configPath}`);
    }
    return new PlanExecuteReviewEngine(raw);
  }

  static async loadFromWorkspace(workspaceRoot: string): Promise<PlanExecuteReviewEngine | null> {
    const candidates = [
      path.join(workspaceRoot, 'planner/plan-execute-review.yaml'),
      path.join(workspaceRoot, '../configs/planner/plan-execute-review.yaml'),
    ];
    for (const file of candidates) {
      try {
        return await PlanExecuteReviewEngine.load(file);
      } catch {
        // try next
      }
    }
    return null;
  }

  get phases(): PlannerPhase[] {
    return this.config.spec.phases;
  }

  async run(runner: PlannerRunner, input: PlannerRunInput): Promise<PlannerPhaseResult[]> {
    const results: PlannerPhaseResult[] = [];
    let prior = input.context ?? '';

    for (const phase of this.config.spec.phases) {
      const prompt = [
        `# Phase: ${phase.name.toUpperCase()}`,
        `Task: ${input.task}`,
        prior ? `\n## Prior context\n${prior}` : '',
        `\n## Instructions\n${phase.prompt}`,
      ]
        .filter(Boolean)
        .join('\n');

      const output = await runner.runAgent(phase.agent, prompt);
      results.push({ phase: phase.name, agent: phase.agent, output });
      prior = `${prior}\n\n[${phase.name}] ${output}`.trim();
    }

    return results;
  }
}
