import { spawnVendorCli, combinedOutput } from './spawn-vendor-cli.js';

export const CURSOR_CONNECTION_SERVICE = 'cursor';

export interface CursorSetupTokenOptions {
  binary?: string;
  timeoutMs?: number;
}

/** Run official Cursor CLI browser login (`agent login`). */
export async function runCursorSetupToken(
  options: CursorSetupTokenOptions = {},
): Promise<{ payload: string; message: string }> {
  const binary = options.binary ?? 'agent';

  const login = await spawnVendorCli({
    binary,
    args: ['login'],
    timeoutMs: options.timeoutMs,
  });

  const loginOutput = combinedOutput(login);
  if (login.exitCode !== 0 && !/login successful|logged in|authenticated/i.test(loginOutput)) {
    throw new Error(
      login.exitCode === 0
        ? 'agent login completed but authentication could not be confirmed'
        : `agent login failed (exit ${login.exitCode ?? 'unknown'}): ${loginOutput || 'no output'}`,
    );
  }

  const status = await spawnVendorCli({
    binary,
    args: ['status'],
    timeoutMs: 30_000,
  });
  const statusOutput = combinedOutput(status);

  if (status.exitCode !== 0 || /not logged in|not authenticated/i.test(statusOutput)) {
    throw new Error(
      `Cursor CLI is not authenticated after login. Run \`${binary} status\` manually.\n${statusOutput}`,
    );
  }

  return {
    payload: JSON.stringify({
      authMethod: 'agent-login',
      status: statusOutput,
      loggedInAt: new Date().toISOString(),
    }),
    message: 'Cursor CLI session saved (subscription auth via desktop login — not API key).',
  };
}
