import type { BuiltinToolResult } from '@anvio/core';

export interface SkillCallInput {
  slug: string;
  params?: Record<string, unknown>;
}

export interface SkillCallResult {
  outputs: Record<string, unknown>;
  trace: string;
}

export type SkillCallFn = (input: SkillCallInput) => Promise<SkillCallResult | Record<string, unknown> | string>;

export async function skillCallTool(
  fn: SkillCallFn | undefined,
  input: SkillCallInput,
): Promise<BuiltinToolResult['output']> {
  if (!fn) {
    return {
      note: 'skill_call is not wired — ensure the agent runtime has a skillCatalog configured',
      slug: input.slug,
    };
  }
  const result = await fn(input);

  // Rich result with trace → pipe step outputs back as formatted text
  if (result && typeof result === 'object' && 'trace' in result && 'outputs' in result) {
    const rich = result as SkillCallResult;
    return `${rich.trace}\n\n---\n_Raw outputs: ${JSON.stringify(rich.outputs)}_`;
  }

  return result;
}
