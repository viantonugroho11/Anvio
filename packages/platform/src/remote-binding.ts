import path from 'node:path';
import type { ExecResult, ExecTarget, SessionStore, SlashCommand } from '@anvio/core';
import { ensureRemoteKey, TailnetSshTarget, type RemoteKey } from '@anvio/runtimes';

/** Stored on `session.metadata.remote` while a thread is bound (ADR 0034). */
export interface RemoteBindingRecord {
  address: string;
  dir: string;
  /** The user whose key and machine this is; only they can drive remote tools. */
  userId: string;
  boundAt: string;
}

export interface RemoteBindingOptions {
  sessions: SessionStore;
  workspacePath: string;
  /** Injected for tests; defaults to ssh-keygen + TailnetSshTarget. */
  ensureKey?: (userId: string) => Promise<RemoteKey>;
  createTarget?: (record: RemoteBindingRecord, key: RemoteKey) => ExecTarget;
}

/** Refuses every operation: the session is bound to someone else's machine. */
class ForeignBindingTarget implements ExecTarget {
  constructor(readonly label: string) {}
  private deny(): never {
    throw new Error(`This thread is bound to another user's machine (${this.label}); only they can run tools there.`);
  }
  async exec(): Promise<ExecResult> {
    return this.deny();
  }
  async readFile(): Promise<string> {
    return this.deny();
  }
  async writeFile(): Promise<void> {
    this.deny();
  }
  async listDir(): Promise<Array<{ name: string; type: 'file' | 'dir' | 'other' }>> {
    return this.deny();
  }
}

function readBinding(metadata: Record<string, unknown> | undefined): RemoteBindingRecord | undefined {
  const remote = metadata?.remote as RemoteBindingRecord | undefined;
  return remote?.address && remote.dir && remote.userId ? remote : undefined;
}

/** `/remote` command plus the per-session ExecTarget resolver for ToolGateway. */
export function createRemoteBinding(options: RemoteBindingOptions): {
  command: SlashCommand;
  resolveExecTarget: (sessionId: string, userId?: string) => Promise<ExecTarget | undefined>;
} {
  const ensureKey = options.ensureKey ?? ((userId: string) => ensureRemoteKey(options.workspacePath, userId));
  const createTarget =
    options.createTarget ??
    ((record: RemoteBindingRecord, key: RemoteKey) =>
      new TailnetSshTarget({
        address: record.address,
        dir: record.dir,
        identityFile: key.identityFile,
        knownHostsFile: key.knownHostsFile,
      }));

  const command: SlashCommand = {
    name: 'remote',
    description: 'Run shell/file tools on your machine: /remote key | <address> <dir> | off | status',
    syncable: false,
    handler: async (ctx) => {
      const sub = ctx.argsList[0]?.toLowerCase() ?? 'status';
      const session = await options.sessions.get(ctx.sessionId);
      if (!session) return { swallow: true, reply: 'No session for this thread yet — say something first.' };
      const current = readBinding(session.metadata);

      if (sub === 'key') {
        const key = await ensureKey(ctx.userId);
        return {
          swallow: true,
          reply: [
            'On your machine, serve SSH on your tailnet with this key authorized:',
            '```',
            'tailcat genkey --key=default',
            `tailcat serve --key=default --ssh-authorized-keys="${key.publicKey}" ssh`,
            '```',
            'Then bind this thread: `/remote <address> <absolute dir>`',
          ].join('\n'),
        };
      }
      if (sub === 'status') {
        return {
          swallow: true,
          reply: current
            ? `Bound to ${current.address}:${current.dir} (owner ${current.userId}).`
            : 'Not bound. Tools run on the Anvio host.',
        };
      }
      if (sub === 'off') {
        if (!current) return { swallow: true, reply: 'Not bound.' };
        if (current.userId !== ctx.userId) return { swallow: true, reply: 'Only the user who bound this thread can unbind it.' };
        await options.sessions.update(ctx.sessionId, { metadata: { ...session.metadata, remote: undefined } });
        return { swallow: true, reply: 'Unbound. Tools run on the Anvio host again.' };
      }

      const [address, dir] = ctx.argsList;
      if (!address || !dir || !path.posix.isAbsolute(dir)) {
        return { swallow: true, reply: 'Usage: /remote <address> <absolute dir>   (run /remote key first)' };
      }
      if (current && current.userId !== ctx.userId) {
        return { swallow: true, reply: 'This thread is already bound to another user.' };
      }
      await ensureKey(ctx.userId);
      const record: RemoteBindingRecord = { address, dir, userId: ctx.userId, boundAt: new Date().toISOString() };
      await options.sessions.update(ctx.sessionId, { metadata: { ...session.metadata, remote: record } });
      return { swallow: true, reply: `Bound to ${address}:${dir}. Shell and file tools now run there; \`/remote off\` to stop.` };
    },
  };

  const resolveExecTarget = async (sessionId: string, userId?: string): Promise<ExecTarget | undefined> => {
    const session = await options.sessions.get(sessionId);
    const record = readBinding(session?.metadata);
    if (!record) return undefined;
    const label = `tailnet:${record.address}:${record.dir}`;
    if (userId && userId !== record.userId) return new ForeignBindingTarget(label);
    return createTarget(record, await ensureKey(record.userId));
  };

  return { command, resolveExecTarget };
}
