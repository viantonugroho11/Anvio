import { describe, expect, it } from 'vitest';
import {
  buildClaudeCodeAgentEnv,
  extractOAuthTokenFromSetupOutput,
  parseClaudeCodeConnectionPayload,
  resolveClaudeCodeOAuthToken,
} from './claude-code-auth.js';

describe('claude-code-auth', () => {
  it('parses JSON connection payload', () => {
    expect(
      parseClaudeCodeConnectionPayload(JSON.stringify({ oauthToken: 'sk-ant-oat01-test' })),
    ).toBe('sk-ant-oat01-test');
  });

  it('extracts token from setup-token output', () => {
    const output = 'Success! Token:\nsk-ant-oat01-abc123\nExpires in 1 year';
    expect(extractOAuthTokenFromSetupOutput(output)).toBe('sk-ant-oat01-abc123');
  });

  it('builds env without API key shadowing OAuth', () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-key';
    try {
      const env = buildClaudeCodeAgentEnv('sk-ant-oat01-runtime');
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-runtime');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('anvio/0.1.0');
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  it('resolves OAuth token from broker callback', async () => {
    const token = await resolveClaudeCodeOAuthToken({
      resolveOAuthToken: async () => 'sk-ant-oat01-broker',
      userId: 'user-1',
      channel: 'cli',
      threadId: 'sess-1',
    });
    expect(token).toBe('sk-ant-oat01-broker');
  });
});
