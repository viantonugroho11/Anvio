import type { RuntimeConnectionContext, RuntimeConnectionResolver } from '@anvio/core';
import { CURSOR_CONNECTION_SERVICE } from '../setup-token/cursor-setup-token.js';

export interface ResolveCursorSessionOptions extends Partial<RuntimeConnectionContext> {
  resolveConnectionPayload?: RuntimeConnectionResolver;
}

export function parseCursorConnectionPayload(payload: string): boolean {
  const trimmed = payload.trim();
  if (!trimmed) return false;

  try {
    const parsed = JSON.parse(trimmed) as { authMethod?: string; status?: string };
    if (parsed.authMethod === 'agent-login') return true;
    if (parsed.status && !/not logged in|not authenticated/i.test(parsed.status)) return true;
    return false;
  } catch {
    return /logged in|authenticated/i.test(trimmed);
  }
}

export async function hasCursorCliSession(
  options: ResolveCursorSessionOptions = {},
): Promise<boolean> {
  if (!options.resolveConnectionPayload || !options.userId || !options.channel) {
    return false;
  }

  const payload = await options.resolveConnectionPayload({
    userId: options.userId,
    channel: options.channel,
    threadId: options.threadId ?? 'default',
    service: CURSOR_CONNECTION_SERVICE,
  });

  return payload ? parseCursorConnectionPayload(payload) : false;
}

export function isCursorRuntimeConfigured(options: {
  acpEndpoint?: string;
  resolveConnectionPayload?: RuntimeConnectionResolver;
}): boolean {
  return Boolean(
    options.acpEndpoint?.trim() ||
      process.env.ANVIO_ACP_ENDPOINT?.trim() ||
      options.resolveConnectionPayload,
  );
}
