import { describe, expect, it } from 'vitest';
import {
  detectSetupTokenVendor,
  parseRuntimeSetupTokenVendor,
  RUNTIME_SETUP_TOKEN_VENDORS,
} from './index.js';

describe('setup-token registry', () => {
  it('lists supported vendors', () => {
    expect(RUNTIME_SETUP_TOKEN_VENDORS).toEqual(['claude', 'cursor', 'codex', 'antigravity', 'nous']);
  });

  it('detects vendor flags from argv', () => {
    expect(detectSetupTokenVendor(['setup-token', '--claude'])).toBe('claude');
    expect(detectSetupTokenVendor(['setup-token', '--cursor'])).toBe('cursor');
    expect(detectSetupTokenVendor(['setup-token', '--codex'])).toBe('codex');
    expect(detectSetupTokenVendor(['setup-token', '--antigravity'])).toBe('antigravity');
    expect(detectSetupTokenVendor(['setup-token', '--nous'])).toBe('nous');
    expect(detectSetupTokenVendor(['setup-token'])).toBeNull();
  });

  it('parses vendor aliases', () => {
    expect(parseRuntimeSetupTokenVendor('claude-code')).toBe('claude');
    expect(parseRuntimeSetupTokenVendor('cursor')).toBe('cursor');
    expect(parseRuntimeSetupTokenVendor('nous')).toBe('nous');
    expect(parseRuntimeSetupTokenVendor('unknown')).toBeNull();
  });
});
