import { AnvioError } from '@anvio/core';
import {
  CLAUDE_CODE_CONNECTION_SERVICE,
  runClaudeSetupToken,
} from '../claude-code/claude-code-auth.js';
import {
  ANTIGRAVITY_CONNECTION_SERVICE,
  runAntigravitySetupToken,
} from './antigravity-setup-token.js';
import {
  CODEX_CONNECTION_SERVICE,
  runCodexSetupToken,
} from './codex-setup-token.js';
import {
  CURSOR_CONNECTION_SERVICE,
  runCursorSetupToken,
} from './cursor-setup-token.js';
import {
  NOUS_CONNECTION_SERVICE,
  runNousSetupToken,
} from './nous-setup-token.js';

export type RuntimeSetupTokenVendor = 'claude' | 'cursor' | 'codex' | 'antigravity' | 'nous';

export const RUNTIME_SETUP_TOKEN_VENDORS: RuntimeSetupTokenVendor[] = [
  'claude',
  'cursor',
  'codex',
  'antigravity',
  'nous',
];

export const RUNTIME_CONNECTION_SERVICE: Record<RuntimeSetupTokenVendor, string> = {
  claude: CLAUDE_CODE_CONNECTION_SERVICE,
  cursor: CURSOR_CONNECTION_SERVICE,
  codex: CODEX_CONNECTION_SERVICE,
  antigravity: ANTIGRAVITY_CONNECTION_SERVICE,
  nous: NOUS_CONNECTION_SERVICE,
};

export interface RunRuntimeSetupTokenOptions {
  binary?: string;
  explicitToken?: string;
  timeoutMs?: number;
  autoInstall?: boolean;
  /** Nous only — called with the authorize URL before waiting for the OAuth callback. */
  onAuthorizeUrl?: (url: string) => void;
}

export interface RuntimeSetupTokenResult {
  vendor: RuntimeSetupTokenVendor;
  service: string;
  payload: string;
  message: string;
}

export function parseRuntimeSetupTokenVendor(flag: string): RuntimeSetupTokenVendor | null {
  switch (flag) {
    case 'claude':
    case 'claude-code':
      return 'claude';
    case 'cursor':
      return 'cursor';
    case 'codex':
      return 'codex';
    case 'antigravity':
      return 'antigravity';
    case 'nous':
      return 'nous';
    default:
      return null;
  }
}

export function detectSetupTokenVendor(args: string[]): RuntimeSetupTokenVendor | null {
  for (const vendor of RUNTIME_SETUP_TOKEN_VENDORS) {
    if (args.includes(`--${vendor}`)) return vendor;
  }
  return null;
}

export async function runRuntimeSetupToken(
  vendor: RuntimeSetupTokenVendor,
  options: RunRuntimeSetupTokenOptions = {},
): Promise<RuntimeSetupTokenResult> {
  const service = RUNTIME_CONNECTION_SERVICE[vendor];

  switch (vendor) {
    case 'claude': {
      let token = options.explicitToken;
      if (!token) {
        token = await runClaudeSetupToken(options.binary ?? 'claude', options.timeoutMs);
      }
      return {
        vendor,
        service,
        payload: JSON.stringify({ oauthToken: token }),
        message: 'Claude Code OAuth saved (Pro/Max subscription — not ANTHROPIC_API_KEY).',
      };
    }
    case 'cursor': {
      const result = await runCursorSetupToken({
        binary: options.binary ?? 'agent',
        timeoutMs: options.timeoutMs,
      });
      return { vendor, service, ...result };
    }
    case 'codex': {
      const result = await runCodexSetupToken({
        binary: options.binary ?? 'codex',
        timeoutMs: options.timeoutMs,
        explicitToken: options.explicitToken,
      });
      return { vendor, service, ...result };
    }
    case 'antigravity': {
      const result = await runAntigravitySetupToken({
        binary: options.binary,
        explicitToken: options.explicitToken,
        timeoutMs: options.timeoutMs,
        autoInstall: options.autoInstall,
      });
      return { vendor, service, ...result };
    }
    case 'nous': {
      const result = await runNousSetupToken({
        explicitToken: options.explicitToken,
        timeoutMs: options.timeoutMs,
        onAuthorizeUrl: options.onAuthorizeUrl,
      });
      return { vendor, service, ...result };
    }
    default: {
      const _exhaustive: never = vendor;
      throw new AnvioError('VALIDATION_ERROR', `Unsupported setup-token vendor: ${_exhaustive}`);
    }
  }
}

export {
  ANTIGRAVITY_CONNECTION_SERVICE,
  runAntigravitySetupToken,
} from './antigravity-setup-token.js';
export {
  CODEX_CONNECTION_SERVICE,
  parseCodexConnectionPayload,
  runCodexSetupToken,
} from './codex-setup-token.js';
export {
  CURSOR_CONNECTION_SERVICE,
  runCursorSetupToken,
} from './cursor-setup-token.js';
export {
  DEFAULT_NOUS_PORTAL_URL,
  NOUS_CONNECTION_SERVICE,
  parseNousConnectionPayload,
  runNousSetupToken,
} from './nous-setup-token.js';
