import { describe, expect, it } from 'vitest';
import { vendorCliEnvWithLocalBin } from './vendor-cli-install.js';

describe('vendorCliEnvWithLocalBin', () => {
  it('prepends ~/.local/bin to PATH when missing', () => {
    const env = vendorCliEnvWithLocalBin({
      HOME: '/home/alice',
      PATH: '/usr/bin',
    });
    expect(env.PATH).toBe('/home/alice/.local/bin:/usr/bin');
  });

  it('does not duplicate ~/.local/bin', () => {
    const env = vendorCliEnvWithLocalBin({
      HOME: '/home/alice',
      PATH: '/home/alice/.local/bin:/usr/bin',
    });
    expect(env.PATH).toBe('/home/alice/.local/bin:/usr/bin');
  });
});
