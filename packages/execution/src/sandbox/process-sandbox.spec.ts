import { describe, expect, it } from 'vitest';
import os from 'node:os';
import { buildSandboxEnv } from '@anvio/core';
import { runInProcessSandbox } from './process-sandbox.js';

const base = { cwd: os.tmpdir(), env: {}, networkEnabled: false };

describe('buildSandboxEnv', () => {
  it('keeps PATH but drops secrets from the host environment', () => {
    const env = buildSandboxEnv({}, false, {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      JWT_SECRET: 'jwt',
      ANVIO_CREDENTIALS_PASSPHRASE: 'pass',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('JWT_SECRET');
    expect(env).not.toHaveProperty('ANVIO_CREDENTIALS_PASSPHRASE');
    expect(env.ANVIO_NETWORK).toBe('0');
  });

  it('passes through operator-listed variables and explicit request env', () => {
    const env = buildSandboxEnv({ REQUEST_VAR: 'r' }, true, {
      PATH: '/bin',
      ANVIO_SANDBOX_ENV_PASSTHROUGH: 'GITHUB_TOKEN, NPM_TOKEN',
      GITHUB_TOKEN: 'gh',
      OPENAI_API_KEY: 'sk',
    });
    expect(env.GITHUB_TOKEN).toBe('gh');
    expect(env.REQUEST_VAR).toBe('r');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env.ANVIO_NETWORK).toBe('1');
  });
});

describe('runInProcessSandbox', () => {
  it('does not expose host secrets to executed code', async () => {
    process.env.ANVIO_TEST_SECRET_SHOULD_NOT_LEAK = 'leaked';
    try {
      const result = await runInProcessSandbox({
        ...base,
        runtime: 'shell',
        code: 'echo "[$ANVIO_TEST_SECRET_SHOULD_NOT_LEAK]"',
        timeoutMs: 5_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('[]');
    } finally {
      delete process.env.ANVIO_TEST_SECRET_SHOULD_NOT_LEAK;
    }
  });

  it('kills background grandchildren on timeout instead of hanging on their pipes', async () => {
    const started = Date.now();
    const result = await runInProcessSandbox({
      ...base,
      runtime: 'shell',
      code: 'sleep 30 & sleep 30',
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('caps captured output', async () => {
    const result = await runInProcessSandbox({
      ...base,
      runtime: 'shell',
      code: 'head -c 200000 /dev/zero | tr "\\0" "a"',
      timeoutMs: 5_000,
      maxOutputBytes: 1_000,
    });
    expect(result.stdout.startsWith('a'.repeat(1_000))).toBe(true);
    expect(result.stdout).toMatch(/output truncated: 199000 more bytes/);
  });
});
