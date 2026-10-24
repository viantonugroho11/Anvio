/**
 * Variables a child needs to find interpreters and behave normally. Everything else
 * in the host environment — model API keys, `JWT_SECRET`,
 * `ANVIO_CREDENTIALS_PASSPHRASE` — used to be inherited by model-written code
 * (audit CQ-003). Operators can pass more through with
 * `ANVIO_SANDBOX_ENV_PASSTHROUGH=NAME1,NAME2`.
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'GOPATH',
  'GOROOT',
  'GOCACHE',
  'GOMODCACHE',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
];

export function buildSandboxEnv(
  extra: Record<string, string>,
  networkEnabled: boolean,
  hostEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const passthrough = (hostEnv.ANVIO_SANDBOX_ENV_PASSTHROUGH ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const env: Record<string, string> = {};
  for (const key of [...SAFE_ENV_KEYS, ...passthrough]) {
    const value = hostEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra, ANVIO_NETWORK: networkEnabled ? '1' : '0' };
}
