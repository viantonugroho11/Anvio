import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemStorageProvider } from '@anvio/storage';
import { EncryptedCredentialStore } from './encrypted-store.js';

let root: string;
let storage: FilesystemStorageProvider;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-creds-'));
  storage = new FilesystemStorageProvider(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('EncryptedCredentialStore', () => {
  it('round-trips through put/get without storing plaintext', async () => {
    const store = new EncryptedCredentialStore(storage, 'pass');
    await store.put('openai', 'k1', 'sk-secret-value');
    expect(await store.get('openai', 'k1')).toBe('sk-secret-value');
    const raw = await fs.readFile(
      path.join(root, 'credentials/encrypted/openai.enc.json'),
      'utf-8',
    );
    expect(raw).not.toContain('sk-secret-value');
  });

  it('stays compatible with blobs written by the synchronous API', async () => {
    const writer = new EncryptedCredentialStore(storage, 'pass');
    const sealed = writer.encrypt('legacy');
    const reader = new EncryptedCredentialStore(storage, 'pass');
    expect(reader.decrypt(sealed)).toBe('legacy');
  });

  it('fails to decrypt with the wrong passphrase', async () => {
    await new EncryptedCredentialStore(storage, 'right').put('p', 'k', 'v');
    await expect(new EncryptedCredentialStore(storage, 'wrong').get('p', 'k')).rejects.toThrow();
  });

  it('keeps every credential when puts to one pool overlap', async () => {
    const store = new EncryptedCredentialStore(storage, 'pass');
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.put('pool', `k${i}`, `v${i}`)));
    for (let i = 0; i < 8; i++) expect(await store.get('pool', `k${i}`)).toBe(`v${i}`);
  });

  it('returns null for unknown credentials', async () => {
    expect(await new EncryptedCredentialStore(storage, 'pass').get('none', 'x')).toBeNull();
  });
});
