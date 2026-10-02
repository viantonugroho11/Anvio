import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRemoteKey } from './remote-keys.js';

describe('ensureRemoteKey', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-remote-keys-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const fakeKeygen = vi.fn(async (args: string[]) => {
    const file = args[args.indexOf('-f') + 1]!;
    await fs.writeFile(file, 'PRIVATE');
    await fs.writeFile(`${file}.pub`, 'ssh-ed25519 AAAATEST anvio:slack:U1\n');
  });

  it('generates once per user under connections/remote and returns only the public key', async () => {
    const first = await ensureRemoteKey(root, 'slack:U1', fakeKeygen);
    const second = await ensureRemoteKey(root, 'slack:U1', fakeKeygen);
    expect(fakeKeygen).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.publicKey).toBe('ssh-ed25519 AAAATEST anvio:slack:U1');
    expect(first.identityFile).toBe(path.join(root, 'connections/remote/slack_U1/id_ed25519'));
    expect((await fs.stat(first.identityFile)).mode & 0o777).toBe(0o600);
  });
});
