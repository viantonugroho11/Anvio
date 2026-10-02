import { describe, expect, it, vi } from 'vitest';
import { RemoteExecError } from '@anvio/core';
import { shellQuote, TailnetSshTarget, type SshSpawn } from './tailnet-ssh-target.js';

function target(spawnSsh: SshSpawn, address = 'dev@dev-mac:2222') {
  return new TailnetSshTarget({
    address,
    dir: '/home/dev/repo',
    identityFile: '/ws/connections/remote/id_ed25519',
    knownHostsFile: '/ws/connections/remote/known_hosts',
    spawnSsh,
  });
}

const ok = (stdout = '') => ({ stdout, stderr: '', code: 0, timedOut: false });

describe('TailnetSshTarget', () => {
  it('quotes single quotes safely', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('runs commands in the bound dir with an isolated key and known_hosts', async () => {
    const spawnSsh = vi.fn<SshSpawn>(async () => ok('hi\n'));
    const res = await target(spawnSsh).exec("echo 'hi'", { timeoutMs: 1000, login: true });
    expect(res).toEqual({ stdout: 'hi\n', stderr: '', code: 0, truncated: false, timedOut: false });
    const args = spawnSsh.mock.calls[0]![0];
    expect(args).toEqual(
      expect.arrayContaining(['-i', '/ws/connections/remote/id_ed25519', '-p', '2222', 'dev@dev-mac', 'BatchMode=yes']),
    );
    expect(args).toContain('UserKnownHostsFile=/ws/connections/remote/known_hosts');
    expect(args.at(-1)).toBe(`cd '/home/dev/repo' && bash -lc 'echo '\\''hi'\\'''`);
  });

  it('refuses paths that escape the bound dir', async () => {
    await expect(target(vi.fn(async () => ok())).readFile('../../etc/passwd')).rejects.toThrow('escapes');
  });

  it('writes through stdin and parses ls output', async () => {
    const spawnSsh = vi.fn<SshSpawn>(async (args) => (args.at(-1)!.startsWith('ls') ? ok('src/\na.ts\n') : ok()));
    const t = target(spawnSsh);
    await t.writeFile('src/b.ts', 'export {}');
    expect(spawnSsh.mock.calls[0]![1]).toBe('export {}');
    expect(spawnSsh.mock.calls[0]![0].at(-1)).toBe(`mkdir -p -- '/home/dev/repo/src' && cat > '/home/dev/repo/src/b.ts'`);
    expect(await t.listDir('.')).toEqual([
      { name: 'src', type: 'dir' },
      { name: 'a.ts', type: 'file' },
    ]);
  });

  it('maps ssh exit 255 to typed transport errors with the started flag', async () => {
    const denied = target(vi.fn(async () => ({ stdout: '', stderr: 'dev@dev-mac: Permission denied (publickey).', code: 255, timedOut: false })));
    await expect(denied.exec('ls', { timeoutMs: 1000 })).rejects.toMatchObject({ code: 'REMOTE_AUTH_FAILED', started: false });

    const dropped = target(vi.fn(async () => ({ stdout: 'partial', stderr: 'Connection reset', code: 255, timedOut: false })));
    const error = await dropped.exec('make', { timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteExecError);
    expect(error).toMatchObject({ code: 'REMOTE_UNREACHABLE', started: true });
  });

  it('reports a non-zero remote exit as a normal result', async () => {
    const t = target(vi.fn(async () => ({ stdout: '', stderr: 'boom', code: 2, timedOut: false })));
    expect(await t.exec('false', { timeoutMs: 1000 })).toMatchObject({ code: 2, stderr: 'boom' });
  });
});
