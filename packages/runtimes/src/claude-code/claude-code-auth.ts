import { spawn } from 'node:child_process';

export const CLAUDE_CODE_CONNECTION_SERVICE = 'claude-code';
export const CLAUDE_CODE_OAUTH_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

const OAUTH_TOKEN_PATTERN = /sk-ant-[A-Za-z0-9_-]+/;

export interface ResolveClaudeCodeOAuthOptions {
  oauthToken?: string;
  resolveOAuthToken?: (input: {
    userId: string;
    channel: string;
    threadId: string;
  }) => Promise<string | null>;
  userId?: string;
  channel?: string;
  threadId?: string;
}

export function parseClaudeCodeConnectionPayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as { oauthToken?: string; token?: string };
    return parsed.oauthToken?.trim() || parsed.token?.trim() || null;
  } catch {
    const match = trimmed.match(OAUTH_TOKEN_PATTERN);
    return match?.[0] ?? (trimmed.startsWith('sk-ant-') ? trimmed : null);
  }
}

export async function resolveClaudeCodeOAuthToken(
  options: ResolveClaudeCodeOAuthOptions = {},
): Promise<string | null> {
  if (options.oauthToken?.trim()) {
    return options.oauthToken.trim();
  }

  if (options.resolveOAuthToken && options.userId && options.channel) {
    const fromBroker = await options.resolveOAuthToken({
      userId: options.userId,
      channel: options.channel,
      threadId: options.threadId ?? 'default',
    });
    if (fromBroker?.trim()) {
      return fromBroker.trim();
    }
  }

  const fromEnv = process.env[CLAUDE_CODE_OAUTH_ENV];
  if (fromEnv?.trim()) {
    return fromEnv.trim();
  }

  return null;
}

/** Build subprocess env for Agent SDK — OAuth must not be shadowed by API keys. */
export function buildClaudeCodeAgentEnv(oauthToken: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env[CLAUDE_CODE_OAUTH_ENV] = oauthToken;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'anvio/0.1.0';
  return env;
}

export function extractOAuthTokenFromSetupOutput(output: string): string | null {
  const match = output.match(OAUTH_TOKEN_PATTERN);
  return match?.[0] ?? null;
}

/** Run official `claude setup-token` and return the OAuth token from stdout/stderr. */
export async function runClaudeSetupToken(binary = 'claude', timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['setup-token'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude setup-token timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;
      const token = extractOAuthTokenFromSetupOutput(combined);
      if (token) {
        resolve(token);
        return;
      }
      reject(
        new Error(
          code === 0
            ? 'claude setup-token completed but no OAuth token was found in output'
            : `claude setup-token failed (exit ${code ?? 'unknown'}): ${combined.trim() || 'no output'}`,
        ),
      );
    });
  });
}
