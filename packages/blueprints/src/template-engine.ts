export interface TemplateContext {
  inputs: Record<string, unknown>;
  steps: Record<string, { output: string }>;
  date?: string;
  [key: string]: unknown;
}

const VAR_PATTERN = /\{\{([^}]+)\}\}/g;

export function renderTemplate(template: string, context: TemplateContext): string {
  const enriched: TemplateContext = {
    ...context,
    date: context.date ?? new Date().toISOString().slice(0, 10),
  };

  return template.replace(VAR_PATTERN, (_, rawKey: string) => {
    const key = rawKey.trim();
    const value = resolvePath(enriched, key);
    if (value == null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function resolvePath(context: TemplateContext, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function buildDefaultInputs(
  inputs: Record<string, { default?: unknown; required?: boolean }>,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...provided };
  for (const [key, spec] of Object.entries(inputs)) {
    if (result[key] == null && spec.default != null) {
      result[key] = spec.default;
    }
    if (spec.required && result[key] == null) {
      throw new Error(`Missing required blueprint input: ${key}`);
    }
  }
  return result;
}
