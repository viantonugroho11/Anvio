import { AnvioError } from '@anvio/core';
import { combinedOutput, spawnVendorCli } from './spawn-vendor-cli.js';

export const ANTIGRAVITY_CONNECTION_SERVICE = 'antigravity';
export const DEFAULT_ANTIGRAVITY_BINARY = 'agy';

export interface AntigravitySetupTokenOptions {
  binary?: string;
  timeoutMs?: number;
  explicitToken?: string;
}

function isAuthSuccess(output: string, exitCode: number | null): boolean {
  if (exitCode === 0) return true;
  return /authenticated|logged in|authorized|already signed|success/i.test(output);
}

/**
 * Run official [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli)
 * Google Sign-In (local browser or SSH authorization URL).
 */
export async function runAntigravitySetupToken(
  options: AntigravitySetupTokenOptions = {},
): Promise<{ payload: string; message: string }> {
  if (options.explicitToken?.trim()) {
    return {
      payload: JSON.stringify({
        authMethod: 'antigravity-token',
        oauthToken: options.explicitToken.trim(),
      }),
      message:
        'Antigravity token saved manually (CI/headless — use ANTIGRAVITY_TOKEN, not GEMINI_API_KEY).',
    };
  }

  const binary = options.binary ?? DEFAULT_ANTIGRAVITY_BINARY;
  const timeoutMs = options.timeoutMs ?? 300_000;

  // Prefer documented auth subcommand; CLI may also authenticate on first `-p` run.
  let result = await spawnVendorCli({
    binary,
    args: ['auth', 'login'],
    timeoutMs,
  });

  let output = combinedOutput(result);
  if (!isAuthSuccess(output, result.exitCode)) {
    result = await spawnVendorCli({
      binary,
      args: ['-p', 'verify anvio setup-token authentication'],
      timeoutMs,
    });
    output = combinedOutput(result);
  }

  if (!isAuthSuccess(output, result.exitCode)) {
    throw new AnvioError(
      'VALIDATION_ERROR',
      [
        `Antigravity CLI (\`${binary}\`) authentication failed.`,
        'Install: curl -fsSL https://antigravity.google/cli/install.sh | bash',
        'Docs: https://antigravity.google/docs/cli-overview',
        'Headless: pass --token (ANTIGRAVITY_TOKEN) after completing Google Sign-In elsewhere.',
        output,
      ].join('\n'),
    );
  }

  return {
    payload: JSON.stringify({
      authMethod: 'agy-google-oauth',
      binary,
      status: output,
      loggedInAt: new Date().toISOString(),
    }),
    message:
      'Antigravity CLI (agy) Google OAuth session saved — system keyring / Google Sign-In, not GEMINI_API_KEY.',
  };
}
