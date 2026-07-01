import { AnvioError } from '@anvio/core';

export const ANTIGRAVITY_CONNECTION_SERVICE = 'antigravity';

export interface AntigravitySetupTokenOptions {
  binary?: string;
  explicitToken?: string;
}

/** Placeholder until Google Antigravity CLI/SDK integration lands. */
export async function runAntigravitySetupToken(
  options: AntigravitySetupTokenOptions = {},
): Promise<{ payload: string; message: string }> {
  if (options.explicitToken?.trim()) {
    return {
      payload: JSON.stringify({
        authMethod: 'manual-token',
        oauthToken: options.explicitToken.trim(),
      }),
      message: 'Antigravity token saved manually (runtime integration pending).',
    };
  }

  throw new AnvioError(
    'VALIDATION_ERROR',
    'Antigravity setup-token is not available yet. Pass --token when vendor CLI ships, or use --claude / --cursor / --codex.',
  );
}
