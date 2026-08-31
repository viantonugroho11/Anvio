// Placeholder substitution for YAML-loaded config values.
//
// Docs and shipped configs use `${VAR}` / `${VAR:-default}` throughout, but
// nothing was expanding them — the literal string reached the child process
// and every server crashed at spawn (issue #47). The rule matches the shell
// forms most operators know:
//
//   ${NAME}            -> process.env.NAME, or empty string if unset
//   ${NAME:-default}   -> process.env.NAME, or `default` if unset/empty
//   ${NAME:?message}   -> process.env.NAME, or throw with `message`
//
// Escape a literal `${` as `$${` to opt out.

const PLACEHOLDER = /\$\$\{|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*)|:\?([^}]*))?\}/g;

export class MissingEnvError extends Error {
  constructor(
    public readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = 'MissingEnvError';
  }
}

export function expandEnvString(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(PLACEHOLDER, (match, name?: string, def?: string, err?: string) => {
    if (match === '$${') return '${';
    const value = env[name!];
    if (value !== undefined && value !== '') return value;
    if (def !== undefined) return def;
    if (err !== undefined) {
      throw new MissingEnvError(name!, `${name!}: ${err}`);
    }
    return '';
  });
}

export function expandEnvDeep<T>(input: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof input === 'string') {
    return expandEnvString(input, env) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => expandEnvDeep(item, env)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = expandEnvDeep(value, env);
    }
    return out as T;
  }
  return input;
}
