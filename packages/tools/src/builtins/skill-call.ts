import type { BuiltinToolResult } from '@anvio/core';

export interface SkillCallInput {
  slug: string;
  params?: Record<string, unknown>;
}

export type SkillCallFn = (input: SkillCallInput) => Promise<Record<string, unknown> | string>;

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
  return result;
}
