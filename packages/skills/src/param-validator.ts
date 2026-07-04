import type { SkillParameter } from '@anvio/core';

export class SkillParamError extends Error {
  constructor(
    public readonly code: 'SKILL_PARAM_MISSING' | 'SKILL_PARAM_TYPE' | 'SKILL_PARAM_ENUM',
    message: string,
  ) {
    super(message);
    this.name = 'SkillParamError';
  }
}

export type ParamContext = Record<string, unknown>;

/**
 * Validate raw params against a skill's parameter definitions.
 * Returns a merged context of validated params + any defaults.
 * Throws SkillParamError on validation failure.
 */
export function validateParams(
  definitions: SkillParameter[],
  raw: Record<string, unknown> = {},
): ParamContext {
  const ctx: ParamContext = {};

  for (const def of definitions) {
    let value = raw[def.name] ?? def.default;

    if (value === undefined || value === null) {
      if (def.required) {
        throw new SkillParamError(
          'SKILL_PARAM_MISSING',
          `Skill parameter "${def.name}" is required (type: ${def.type})${def.description ? ` — ${def.description}` : ''}`,
        );
      }
      continue;
    }

    // Type coercion
    value = coerce(value, def.type, def.name);

    // Enum check
    if (def.enum?.length && !def.enum.includes(String(value))) {
      throw new SkillParamError(
        'SKILL_PARAM_ENUM',
        `Skill parameter "${def.name}" must be one of: ${def.enum.join(', ')} (got: ${String(value)})`,
      );
    }

    ctx[def.name] = value;
  }

  return ctx;
}

/**
 * Interpolate {{varName}} placeholders in any string value of an args object.
 * Non-string values are passed through unchanged.
 * Unknown placeholders are left as-is.
 */
export function interpolateArgs(
  args: Record<string, unknown> | undefined,
  ctx: ParamContext,
): Record<string, unknown> {
  if (!args) return {};
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [k, interpolateValue(v, ctx)]),
  );
}

function interpolateValue(value: unknown, ctx: ParamContext): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
      key in ctx ? String(ctx[key]) : `{{${key}}}`,
    );
  }
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateValue(v, ctx),
      ]),
    );
  }
  return value;
}

function coerce(value: unknown, type: SkillParameter['type'], name: string): unknown {
  switch (type) {
    case 'number': {
      const n = Number(value);
      if (isNaN(n)) {
        throw new SkillParamError('SKILL_PARAM_TYPE', `Skill parameter "${name}" must be a number (got: ${String(value)})`);
      }
      return n;
    }
    case 'boolean': {
      if (value === 'true' || value === true) return true;
      if (value === 'false' || value === false) return false;
      throw new SkillParamError('SKILL_PARAM_TYPE', `Skill parameter "${name}" must be a boolean (got: ${String(value)})`);
    }
    case 'array':
      if (!Array.isArray(value)) {
        throw new SkillParamError('SKILL_PARAM_TYPE', `Skill parameter "${name}" must be an array`);
      }
      return value;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        throw new SkillParamError('SKILL_PARAM_TYPE', `Skill parameter "${name}" must be an object`);
      }
      return value;
    case 'string':
    default:
      return String(value);
  }
}
