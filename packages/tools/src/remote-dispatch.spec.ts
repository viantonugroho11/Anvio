import { describe, expect, it, vi } from 'vitest';
import type { ExecTarget } from '@anvio/core';
import { RemoteExecError } from '@anvio/core';
import { ToolGateway } from './gateway.js';

function fakeTarget(files: Record<string, string> = {}): ExecTarget {
  return {
    label: 'tailnet:dev-mac:/repo',
    exec: vi.fn(async (cmd: string) => ({ stdout: `ran ${cmd}`, stderr: '', code: 0, truncated: false, timedOut: false })),
    readFile: vi.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p]!;
    }),
    writeFile: vi.fn(async (p: string, c: string) => void (files[p] = c)),
    listDir: vi.fn(async () => [{ name: 'a.ts', type: 'file' as const }]),
  };
}

async function gateway(target?: ExecTarget) {
  const gw = await ToolGateway.load('/nonexistent-workspace', { resolveExecTarget: async () => target });
  // The default gateway.yaml disables mutating tools; enable the ones under test.
  for (const name of ['file_read', 'file_write', 'list_dir', 'edit_file', 'run_shell', 'file_delete'] as const) {
    gw.spec.tools[name] = { ...gw.spec.tools[name], enabled: true };
  }
  return gw;
}

const ctx = { sessionId: 's1', agentId: 'a' };

describe('ToolGateway remote dispatch', () => {
  it('routes file and shell tools to the bound target', async () => {
    const files = { 'src/a.ts': 'const x = 1;' };
    const target = fakeTarget(files);
    const gw = await gateway(target);

    expect((await gw.call({ name: 'anvio_tools__file_read', arguments: { path: 'src/a.ts' } }, ctx)).output).toEqual({
      path: 'src/a.ts',
      content: 'const x = 1;',
    });
    const edit = await gw.call(
      { name: 'anvio_tools__edit_file', arguments: { path: 'src/a.ts', old_string: '1', new_string: '2' } },
      ctx,
    );
    expect(edit.status).toBe('completed');
    expect(files['src/a.ts']).toBe('const x = 2;');
    const shell = await gw.call({ name: 'anvio_tools__run_shell', arguments: { command: 'ls' } }, ctx);
    expect(shell).toMatchObject({ status: 'completed', output: { stdout: 'ran ls', exitCode: 0 } });
    expect(target.exec).toHaveBeenCalledWith('ls', expect.objectContaining({ login: true }));
  });

  it('refuses host-only tools while bound instead of running them on the host', async () => {
    const res = await (await gateway(fakeTarget())).call({ name: 'anvio_tools__file_delete', arguments: { path: 'x' } }, ctx);
    expect(res.status).toBe('failed');
    expect(res.error).toContain('unavailable while this session is bound to tailnet:dev-mac:/repo');
  });

  it('warns not to retry when a command may already have run', async () => {
    const target = fakeTarget();
    vi.mocked(target.exec).mockRejectedValueOnce(new RemoteExecError('REMOTE_UNREACHABLE', 'connection reset', true));
    const res = await (await gateway(target)).call({ name: 'anvio_tools__run_shell', arguments: { command: 'make deploy' } }, ctx);
    expect(res.error).toContain('do not retry blindly');
  });

  it('leaves unbound sessions on the host path', async () => {
    const res = await (await gateway(undefined)).call({ name: 'anvio_tools__file_read', arguments: { path: 'nope.md' } }, ctx);
    expect(res.status).toBe('failed');
    expect(res.error).not.toContain('bound to');
  });
});
