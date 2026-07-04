import type { RuntimeToolContext, RuntimeToolPort, SkillDefinition } from '@anvio/core';
import { interpolateArgs, validateParams } from './param-validator.js';

export class SkillStepError extends Error {
  constructor(
    public readonly code: 'SKILL_STEP_FAILED' | 'SKILL_TIMEOUT' | 'SKILL_NOT_FOUND',
    message: string,
    public readonly stepId?: string,
  ) {
    super(message);
    this.name = 'SkillStepError';
  }
}

export interface SkillStepResult {
  id: string;
  status: 'ok' | 'skipped' | 'failed';
  output?: unknown;
  error?: string;
}

export interface SkillExecuteResult {
  outputs: Record<string, unknown>;
  steps: SkillStepResult[];
}

export interface SkillExecuteInput {
  skill: SkillDefinition;
  params?: Record<string, unknown>;
  toolPort?: RuntimeToolPort;
  ctx: RuntimeToolContext;
  /** Resolver for composable skill:slug calls — injected by ComposableSkillRegistry */
  resolveSkill?: (slug: string) => Promise<SkillDefinition | null>;
}

/**
 * Mechanically execute a skill's steps against a RuntimeToolPort.
 * Steps with no tool defined are recorded as skipped (prose-only).
 * Handles conditions, {{var}} interpolation, onError, and maxRetries.
 */
export async function executeSkill(input: SkillExecuteInput): Promise<SkillExecuteResult> {
  const { skill, params = {}, toolPort, ctx, resolveSkill } = input;

  // Validate and collect params into context
  const paramCtx = validateParams(skill.spec.parameters, params);
  const outputs: Record<string, unknown> = {};
  const stepResults: SkillStepResult[] = [];

  const timeout = skill.spec.timeout;
  const abortCtrl = timeout ? new AbortController() : null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (abortCtrl && timeout) {
    timeoutHandle = setTimeout(() => abortCtrl.abort(), timeout);
  }

  try {
    for (const step of skill.spec.steps) {
      if (abortCtrl?.signal.aborted) {
        throw new SkillStepError('SKILL_TIMEOUT', `Skill "${skill.spec.name}" timed out`, step.id);
      }

      // Evaluate condition
      if (step.condition && !evaluateCondition(step.condition, paramCtx, outputs)) {
        stepResults.push({ id: step.id, status: 'skipped' });
        continue;
      }

      // Interpolate args
      const interpolatedArgs = interpolateArgs(step.args, { ...paramCtx, ...outputs });

      let attempt = 0;
      const maxAttempts = step.onError === 'retry' ? (step.maxRetries ?? 0) + 1 : 1;
      let lastError: string | undefined;
      let succeeded = false;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const output = await runStep(step, interpolatedArgs, toolPort, ctx, resolveSkill);

          if (step.output) {
            outputs[step.output] = output;
          }
          stepResults.push({ id: step.id, status: 'ok', output });
          succeeded = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt < maxAttempts) continue; // retry
        }
      }

      if (!succeeded) {
        if (step.onError === 'skip') {
          stepResults.push({ id: step.id, status: 'skipped', error: lastError });
          continue;
        }
        throw new SkillStepError(
          'SKILL_STEP_FAILED',
          `Step "${step.id}" in skill "${skill.spec.name}" failed: ${lastError}`,
          step.id,
        );
      }
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  return { outputs, steps: stepResults };
}

async function runStep(
  step: SkillDefinition['spec']['steps'][number],
  args: Record<string, unknown>,
  toolPort: RuntimeToolPort | undefined,
  ctx: RuntimeToolContext,
  resolveSkill: ((slug: string) => Promise<SkillDefinition | null>) | undefined,
): Promise<unknown> {
  if (!step.tool) {
    // Prose-only step — nothing to execute mechanically
    return undefined;
  }

  // Composable skill call: tool: "skill:code-review"
  if (step.tool.startsWith('skill:')) {
    const targetSlug = step.tool.slice(6);
    if (!resolveSkill) {
      throw new Error(`Step "${step.id}" references skill:${targetSlug} but no skill resolver is configured`);
    }
    const targetSkill = await resolveSkill(targetSlug);
    if (!targetSkill) {
      throw new SkillStepError('SKILL_NOT_FOUND', `Composable skill "${targetSlug}" not found`, step.id);
    }
    const result = await executeSkill({
      skill: targetSkill,
      params: args as Record<string, unknown>,
      toolPort,
      ctx,
      resolveSkill,
    });
    return result.outputs;
  }

  if (!toolPort) {
    throw new Error(`Step "${step.id}" requires tool "${step.tool}" but no toolPort is available`);
  }

  // Prefix tool name if needed
  const toolName = step.tool.startsWith('anvio_tools__') ? step.tool : `anvio_tools__${step.tool}`;
  const result = await toolPort.call({ name: toolName, arguments: args }, ctx);

  if (result.status === 'failed') {
    throw new Error(result.error ?? `Tool ${step.tool} failed`);
  }
  if (result.status === 'pending_approval') {
    throw new Error(`Tool ${step.tool} requires approval — skill step execution paused`);
  }

  return result.output;
}

/**
 * Evaluate a simple condition string against a variable context.
 * Supports ==, !=, &&, ||, ! operators and string/boolean literals.
 * Uses restricted Function constructor — only context vars are in scope.
 */
function evaluateCondition(condition: string, ...contexts: Record<string, unknown>[]): boolean {
  const merged = Object.assign({}, ...contexts);
  const keys = Object.keys(merged);
  const values = keys.map((k) => merged[k]);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return !!(${condition});`);
    return Boolean(fn(...values));
  } catch {
    return false;
  }
}
