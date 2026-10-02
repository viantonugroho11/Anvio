import { describe, expect, it, vi } from 'vitest';
import type { ExecTarget, SessionStore, SlashCommandContext, StoredSession } from '@anvio/core';
import { createRemoteBinding } from './remote-binding.js';

function fakeSessions(): SessionStore {
  const sessions = new Map<string, StoredSession>([['s1', { id: 's1', metadata: {} } as StoredSession]]);
  return {
    get: async (id: string) => sessions.get(id) ?? null,
    update: async (id: string, patch: Partial<StoredSession>) => {
      sessions.set(id, { ...sessions.get(id)!, ...patch });
    },
  } as unknown as SessionStore;
}

const key = { identityFile: '/k', knownHostsFile: '/kh', publicKey: 'ssh-ed25519 AAAA anvio:slack:U1' };
const ctx = (userId: string, args: string[]): SlashCommandContext => ({
  channel: 'slack',
  sessionId: 's1',
  userId,
  threadId: 't1',
  isDm: false,
  argsRaw: args.join(' '),
  argsList: args,
});

function binding() {
  const target = { label: 'fake' } as ExecTarget;
  const createTarget = vi.fn(() => target);
  const remote = createRemoteBinding({
    sessions: fakeSessions(),
    workspacePath: '/ws',
    ensureKey: async () => key,
    createTarget,
  });
  return { remote, target, createTarget };
}

describe('/remote binding', () => {
  it('shows only the public key', async () => {
    const reply = (await binding().remote.command.handler(ctx('slack:U1', ['key']))).reply!;
    expect(reply).toContain('ssh-ed25519 AAAA anvio:slack:U1');
    expect(reply).not.toContain('/k');
  });

  it('binds, resolves the target for the owner, refuses others, and unbinds', async () => {
    const { remote, target, createTarget } = binding();
    expect(await remote.resolveExecTarget('s1', 'slack:U1')).toBeUndefined();

    await remote.command.handler(ctx('slack:U1', ['dev-mac', '/home/dev/repo']));
    expect(await remote.resolveExecTarget('s1', 'slack:U1')).toBe(target);
    expect(createTarget).toHaveBeenCalledWith(expect.objectContaining({ address: 'dev-mac', dir: '/home/dev/repo', userId: 'slack:U1' }), key);

    const foreign = await remote.resolveExecTarget('s1', 'slack:U2');
    await expect(foreign!.exec('ls', { timeoutMs: 1 })).rejects.toThrow("another user's machine");
    expect((await remote.command.handler(ctx('slack:U2', ['off']))).reply).toContain('Only the user who bound');
    expect((await remote.command.handler(ctx('slack:U2', ['h2', '/x']))).reply).toContain('already bound');

    expect((await remote.command.handler(ctx('slack:U1', ['off']))).reply).toContain('Unbound');
    expect(await remote.resolveExecTarget('s1', 'slack:U1')).toBeUndefined();
  });

  it('rejects relative dirs', async () => {
    expect((await binding().remote.command.handler(ctx('slack:U1', ['dev-mac', 'repo']))).reply).toContain('Usage');
  });
});
