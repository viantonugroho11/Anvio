import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.resolve(__dirname);

/** Start a child that registers a shutdown handler, then send it a signal. */
function runWithSignal(
  signal: NodeJS.Signals,
  exitCodes = '{}',
): Promise<{ code: number | null; stdout: string }> {
  const script = `
    import { exitOnShutdownSignals } from '@anvio/platform';
    exitOnShutdownSignals('child', async () => {
      await new Promise((r) => setTimeout(r, 50));
      console.log('cleanup-finished');
    }, ${exitCodes});
    console.log('ready');
    setInterval(() => {}, 1000);
  `;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: here,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes('ready') && !child.killed) child.kill(signal);
    });
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

describe('exitOnShutdownSignals (CQ-015)', () => {
  it('finishes async cleanup on SIGTERM before exiting 0', async () => {
    const { code, stdout } = await runWithSignal('SIGTERM');
    expect(stdout).toContain('cleanup-finished');
    expect(code).toBe(0);
  }, 30_000);

  it('uses the caller exit code for SIGINT and still finishes cleanup', async () => {
    const { code, stdout } = await runWithSignal('SIGINT', '{ SIGINT: 130 }');
    expect(stdout).toContain('cleanup-finished');
    expect(code).toBe(130);
  }, 30_000);
});
