import type { BuiltinToolResult, RuntimeToolContext, RuntimeToolPort, SkillDefinition } from '@anvio/core';
import { executeSkill } from './executor.js';
import type { SkillExecuteResult } from './executor.js';

export interface SkillTestCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface SkillTestResult {
  slug: string;
  passed: boolean;
  outputs: Record<string, unknown>;
  steps: SkillExecuteResult['steps'];
  trace: string;
  toolCalls: SkillTestCall[];
  error?: string;
}

/** Mock RuntimeToolPort that records all calls and returns configurable stub outputs */
class MockToolPort implements RuntimeToolPort {
  readonly calls: SkillTestCall[] = [];
  constructor(private readonly stubOutputs: Record<string, unknown> = {}) {}

  listTools(): string[] {
    return ['*'];
  }

  getToolInstructions(): string {
    return '';
  }

  async call(
    call: { name: string; arguments: Record<string, unknown> },
    _ctx: RuntimeToolContext,
  ): Promise<BuiltinToolResult> {
    this.calls.push({ name: call.name, arguments: call.arguments });
    const stub = this.stubOutputs[call.name] ?? this.stubOutputs['*'] ?? `[mock output for ${call.name}]`;
    return { name: call.name, status: 'completed', output: stub };
  }
}

export class SkillTestRunner {
  constructor(
    private readonly skill: SkillDefinition,
    private readonly stubOutputs: Record<string, unknown> = {},
  ) {}

  async run(params: Record<string, unknown> = {}): Promise<SkillTestResult> {
    const mockPort = new MockToolPort(this.stubOutputs);
    try {
      const result = await executeSkill({
        skill: this.skill,
        params,
        toolPort: mockPort,
        ctx: { sessionId: 'test', agentId: 'test' },
      });
      return {
        slug: this.skill.metadata.slug,
        passed: true,
        outputs: result.outputs,
        steps: result.steps,
        trace: result.trace,
        toolCalls: mockPort.calls,
      };
    } catch (err) {
      return {
        slug: this.skill.metadata.slug,
        passed: false,
        outputs: {},
        steps: [],
        trace: '',
        toolCalls: mockPort.calls,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function createSkillTestRunner(
  skill: SkillDefinition,
  stubOutputs?: Record<string, unknown>,
): SkillTestRunner {
  return new SkillTestRunner(skill, stubOutputs);
}
