import type { RuntimeConnectionContext, RuntimeConnectionResolver } from '@anvio/core';
import { ANTIGRAVITY_CONNECTION_SERVICE } from '../setup-token/antigravity-setup-token.js';
import { stripEnvKeys } from '../shared/vendor-cli-runtime.js';
import { vendorCliEnvWithLocalBin } from '../setup-token/vendor-cli-install.js';

export const ANTIGRAVITY_TOKEN_ENV = 'ANTIGRAVITY_TOKEN';

export interface ResolveAntigravityAuthOptions extends Partial<RuntimeConnectionContext> {
  oauthToken?: string;
  resolveConnectionPayload?: RuntimeConnectionResolver;
}

export function parseAntigravityConnectionPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as { oauthToken?: string; token?: string };
    return parsed.oauthToken?.trim() || parsed.token?.trim() || null;
  } catch {
    return trimmed;
  }
}

export async function resolveAntigravityOAuthToken(
  options: ResolveAntigravityAuthOptions = {},
): Promise<string | null> {
  if (options.oauthToken?.trim()) {
    return options.oauthToken.trim();
  }

  if (options.resolveConnectionPayload && options.userId && options.channel) {
    const payload = await options.resolveConnectionPayload({
      userId: options.userId,
      channel: options.channel,
      threadId: options.threadId ?? 'default',
      service: ANTIGRAVITY_CONNECTION_SERVICE,
    });
    if (payload) {
      const token = parseAntigravityConnectionPayload(payload);
      if (token) return token;
    }
  }

  const fromEnv = process.env[ANTIGRAVITY_TOKEN_ENV];
  return fromEnv?.trim() ?? null;
}

export function buildAntigravityAgentEnv(oauthToken?: string | null): NodeJS.ProcessEnv {
  const env = stripEnvKeys(vendorCliEnvWithLocalBin(), [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_API_KEY',
  ]);

  if (oauthToken?.trim()) {
    env[ANTIGRAVITY_TOKEN_ENV] = oauthToken.trim();
  }

  return env;
}

export function isAntigravityRuntimeConfigured(
  options: Pick<ResolveAntigravityAuthOptions, 'oauthToken' | 'resolveConnectionPayload'>,
): boolean {
  return Boolean(
    options.oauthToken?.trim() ||
      options.resolveConnectionPayload ||
      process.env[ANTIGRAVITY_TOKEN_ENV]?.trim(),
  );
}
