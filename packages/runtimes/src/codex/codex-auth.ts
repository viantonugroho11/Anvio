import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeConnectionContext, RuntimeConnectionResolver } from '@anvio/core';
import { CODEX_CONNECTION_SERVICE } from '../setup-token/codex-setup-token.js';
import { stripEnvKeys } from '../shared/vendor-cli-runtime.js';

export const CODEX_ACCESS_TOKEN_ENV = 'CODEX_ACCESS_TOKEN';

export interface ResolveCodexAuthOptions extends Partial<RuntimeConnectionContext> {
  authJson?: string;
  resolveConnectionPayload?: RuntimeConnectionResolver;
}

export function parseCodexAuthJson(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as {
      accessToken?: string;
      auth?: string;
      authPath?: string;
    };
    if (parsed.auth?.trim()) return parsed.auth.trim();
    if (parsed.accessToken?.trim()) {
      return JSON.stringify({ access_token: parsed.accessToken.trim() });
    }
    return null;
  } catch {
    return trimmed.startsWith('{') ? trimmed : null;
  }
}

export async function resolveCodexAuthJson(
  options: ResolveCodexAuthOptions = {},
): Promise<string | null> {
  if (options.authJson?.trim()) {
    return options.authJson.trim();
  }

  if (options.resolveConnectionPayload && options.userId && options.channel) {
    const payload = await options.resolveConnectionPayload({
      userId: options.userId,
      channel: options.channel,
      threadId: options.threadId ?? 'default',
      service: CODEX_CONNECTION_SERVICE,
    });
    if (payload) {
      const parsed = parseCodexAuthJson(payload);
      if (parsed) return parsed;
    }
  }

  const token = process.env[CODEX_ACCESS_TOKEN_ENV];
  if (token?.trim()) {
    return JSON.stringify({ access_token: token.trim() });
  }

  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    return await fs.readFile(authPath, 'utf8');
  } catch {
    return null;
  }
}

/** Prepare isolated HOME so Codex reads auth.json without touching user ~/.codex. */
export async function prepareCodexAuthHome(authJson: string, sessionId: string): Promise<string> {
  const home = path.join(os.tmpdir(), 'anvio-codex', sessionId);
  const codexDir = path.join(home, '.codex');
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(path.join(codexDir, 'auth.json'), authJson, 'utf8');
  return home;
}

export function buildCodexAgentEnv(homeDir: string): NodeJS.ProcessEnv {
  return stripEnvKeys(
    {
      ...process.env,
      HOME: homeDir,
    },
    ['OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT'],
  );
}

export function isCodexRuntimeConfigured(
  options: Pick<ResolveCodexAuthOptions, 'authJson' | 'resolveConnectionPayload'>,
): boolean {
  return Boolean(
    options.authJson?.trim() ||
      options.resolveConnectionPayload ||
      process.env[CODEX_ACCESS_TOKEN_ENV]?.trim(),
  );
}
