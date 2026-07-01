import { describe, expect, it } from 'vitest';
import { runAntigravitySetupToken } from './antigravity-setup-token.js';

describe('runAntigravitySetupToken', () => {
  it('saves explicit token for headless CI', async () => {
    const result = await runAntigravitySetupToken({ explicitToken: 'test-antigravity-token' });
    expect(JSON.parse(result.payload)).toMatchObject({
      authMethod: 'antigravity-token',
      oauthToken: 'test-antigravity-token',
    });
    expect(result.message).toContain('ANTIGRAVITY_TOKEN');
  });
});
