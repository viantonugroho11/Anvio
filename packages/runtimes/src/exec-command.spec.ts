import { describe, expect, it } from 'vitest';
import { execCommand } from './exec-command.js';

describe('execCommand', () => {
  it('returns stdout and exit code without blocking', async () => {
    let ticked = false;
    const pending = execCommand('sh', ['-c', 'sleep 0.1; echo hi']);
    setTimeout(() => (ticked = true), 10);
    const result = await pending;
    expect(ticked).toBe(true); // the event loop kept running while the child ran
    expect(result).toEqual({ stdout: 'hi', stderr: '', exitCode: 0 });
  });

  it('reports non-zero exits', async () => {
    const result = await execCommand('sh', ['-c', 'echo bad >&2; exit 3']);
    expect(result).toMatchObject({ stderr: 'bad', exitCode: 3 });
  });

  it('kills commands that exceed the timeout', async () => {
    const result = await execCommand('sh', ['-c', 'sleep 5'], { timeoutMs: 100 });
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toMatch(/timed out/);
  });

  it('throws when the binary does not exist', async () => {
    await expect(execCommand('definitely-not-a-binary-anvio', [])).rejects.toThrow();
  });
});
