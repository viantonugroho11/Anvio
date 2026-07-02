import { describe, expect, it, afterEach } from 'vitest';
import { parseNousConnectionPayload, runNousSetupToken } from './nous-setup-token.js';

describe('runNousSetupToken', () => {
  const originalMock = process.env.ANVIO_NOUS_MOCK;

  afterEach(() => {
    if (originalMock === undefined) delete process.env.ANVIO_NOUS_MOCK;
    else process.env.ANVIO_NOUS_MOCK = originalMock;
  });

  it('saves an explicit token without hitting the network', async () => {
    const result = await runNousSetupToken({ explicitToken: 'abc123' });
    const parsed = JSON.parse(result.payload);
    expect(parsed.accessToken).toBe('abc123');
    expect(parsed.authMethod).toBe('nous-token');
    expect(result.message).toMatch(/headless/i);
  });

  it('synthesizes a token in mock mode', async () => {
    process.env.ANVIO_NOUS_MOCK = '1';
    const result = await runNousSetupToken();
    const parsed = JSON.parse(result.payload);
    expect(parsed.mock).toBe(true);
    expect(parsed.accessToken).toMatch(/^mock-nous-token-/);
    expect(result.message).toMatch(/ANVIO_NOUS_MOCK/);
  });
});

describe('parseNousConnectionPayload', () => {
  it('extracts accessToken from a JSON payload', () => {
    const payload = JSON.stringify({ accessToken: 'tok-1' });
    expect(parseNousConnectionPayload(payload)).toBe('tok-1');
  });

  it('falls back to raw string for non-JSON payloads', () => {
    expect(parseNousConnectionPayload('raw-token')).toBe('raw-token');
  });
});
