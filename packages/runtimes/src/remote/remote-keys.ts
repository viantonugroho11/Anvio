import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RemoteKey {
  identityFile: string;
  knownHostsFile: string;
  /** `ssh-ed25519 AAAA… anvio:<user>` — the only part ever shown to the user. */
  publicKey: string;
}

/** Filesystem-safe directory name for a channel-prefixed user id. */
function userDir(userId: string): string {
  return userId.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * One ed25519 key pair per (workspace, user) for `/remote` (ADR 0034), generated with
 * ssh-keygen under `<workspace>/connections/remote/<user>/` (gitignored, mode 0600).
 * The private key never leaves the Anvio host; only the public key is returned.
 */
export async function ensureRemoteKey(
  workspaceRoot: string,
  userId: string,
  keygen: (args: string[]) => Promise<unknown> = (args) => execFileAsync('ssh-keygen', args),
): Promise<RemoteKey> {
  const dir = path.join(workspaceRoot, 'connections', 'remote', userDir(userId));
  const identityFile = path.join(dir, 'id_ed25519');
  const knownHostsFile = path.join(dir, 'known_hosts');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.access(identityFile);
  } catch {
    await keygen(['-q', '-t', 'ed25519', '-N', '', '-C', `anvio:${userId}`, '-f', identityFile]);
  }
  await fs.chmod(identityFile, 0o600);
  const publicKey = (await fs.readFile(`${identityFile}.pub`, 'utf-8')).trim();
  return { identityFile, knownHostsFile, publicKey };
}
