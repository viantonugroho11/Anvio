import { describe, expect, it } from 'vitest';
import { resolveCodexCommand } from './codex-binary.js';

describe('resolveCodexCommand', () => {
  it('uses an explicit binary override as-is', () => {
    expect(resolveCodexCommand('/opt/codex')).toEqual({ binary: '/opt/codex', prefixArgs: [] });
  });

  it('runs the bundled @openai/codex launcher through the current node', () => {
    const cmd = resolveCodexCommand(undefined, () => '/nm/@openai/codex/bin/codex.js');
    expect(cmd).toEqual({ binary: process.execPath, prefixArgs: ['/nm/@openai/codex/bin/codex.js'] });
  });

  it('falls back to codex on PATH when the package is missing', () => {
    const cmd = resolveCodexCommand(undefined, () => {
      throw new Error('MODULE_NOT_FOUND');
    });
    expect(cmd).toEqual({ binary: 'codex', prefixArgs: [] });
  });

  it('resolves the real bundled dependency', () => {
    const cmd = resolveCodexCommand();
    expect(cmd.prefixArgs[0]).toMatch(/@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
  });
});
