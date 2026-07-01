import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnVendorCli, combinedOutput } from './spawn-vendor-cli.js';

export const CODEX_CONNECTION_SERVICE = 'codex';

export interface CodexSetupTokenOptions {
  binary?: string;
  authPath?: string;
  timeoutMs?: number;
  explicitToken?: string;
}

function defaultCodexAuthPath(): string {
  return path.join(os.homedir(), '.codex', 'auth.json');
}

/** Run official Codex CLI login and return encrypted auth payload. */
export async function runCodexSetupToken(
  options: CodexSetupTokenOptions = {},
): Promise<{ payload: string; message: string }> {
  const authPath = options.authPath ?? defaultCodexAuthPath();

  if (options.explicitToken?.trim()) {
    const payload = JSON.stringify({
      authMethod: 'access-token',
      accessToken: options.explicitToken.trim(),
    });
    return {
      payload,
      message: 'Codex access token saved (ChatGPT subscription path — not OpenAI API key).',
    };
  }

  const binary = options.binary ?? 'codex';
  const login = await spawnVendorCli({
    binary,
    args: ['login'],
    timeoutMs: options.timeoutMs,
  });

  const loginOutput = combinedOutput(login);
  if (login.exitCode !== 0) {
    throw new Error(
      `codex login failed (exit ${login.exitCode ?? 'unknown'}): ${loginOutput || 'no output'}`,
    );
  }

  let authContent: string;
  try {
    authContent = await fs.readFile(authPath, 'utf8');
  } catch {
    throw new Error(
      `codex login finished but auth file not found at ${authPath}. ${loginOutput}`,
    );
  }

  JSON.parse(authContent);

  return {
    payload: JSON.stringify({
      authMethod: 'codex-auth-json',
      authPath,
      auth: authContent,
      loggedInAt: new Date().toISOString(),
    }),
    message: 'Codex OAuth session saved from ~/.codex/auth.json (subscription auth — not API key).',
  };
}

export function parseCodexConnectionPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      accessToken?: string;
      auth?: string;
    };
    if (parsed.accessToken?.trim()) return parsed.accessToken.trim();
    if (parsed.auth?.trim()) return parsed.auth.trim();
    return null;
  } catch {
    return payload.trim() || null;
  }
}
