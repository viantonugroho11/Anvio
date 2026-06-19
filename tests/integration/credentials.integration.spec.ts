import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCredentialPoolManager, createEncryptedStore } from '@anvio/credentials';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { stringify as stringifyYaml } from 'yaml';

const PASSPHRASE = 'test-passphrase-do-not-log';

describe('Credential Pools', () => {
  let tmpDir: string;
  let storage: FilesystemStorageProvider;
  let manager: ReturnType<typeof createCredentialPoolManager>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-creds-'));
    await Workspace.init(tmpDir);
    storage = new FilesystemStorageProvider(tmpDir);
    manager = createCredentialPoolManager(storage, PASSPHRASE);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts credential round-trip', async () => {
    const store = createEncryptedStore(storage, PASSPHRASE);
    const encrypted = store.encrypt('secret-api-key-value');
    const decrypted = store.decrypt(encrypted);
    expect(decrypted).toBe('secret-api-key-value');
    expect(encrypted).not.toContain('secret-api-key');
  });

  it('adds credential and acquires from pool', async () => {
    await manager.addCredential('anthropic', 'key1', 'sk-test-1');
    await manager.addCredential('anthropic', 'key2', 'sk-test-2');

    const first = await manager.acquire('anthropic');
    const second = await manager.acquire('anthropic');

    expect(['key1', 'key2']).toContain(first.credentialId);
    expect(['key1', 'key2']).toContain(second.credentialId);
    expect(first.value.startsWith('sk-test')).toBe(true);
  });

  it('rotates on rate limit marking', async () => {
    await manager.addCredential('anthropic', 'key1', 'sk-1');
    await manager.addCredential('anthropic', 'key2', 'sk-2');
    await manager.markRateLimited('anthropic', 'key1');

    const acquired = await manager.acquire('anthropic');
    expect(acquired.credentialId).toBe('key2');
  });

  it('failover to fallback pool when primary exhausted', async () => {
    await manager.addCredential('anthropic', 'key1', 'sk-a');
    await manager.addCredential('openai', 'key1', 'sk-o');

    await storage.write(
      'credentials/pools/anthropic.yaml',
      stringifyYaml({
        apiVersion: 'anvio.io/v1',
        kind: 'CredentialPool',
        metadata: { slug: 'anthropic' },
        spec: {
          provider: 'anthropic',
          strategy: 'round_robin',
          credentials: [{ id: 'key1', encryptedRef: 'encrypted/anthropic.enc.json#key1', status: 'disabled' }],
          failover: { enabled: true, fallbackPool: 'openai' },
        },
      }),
    );

    const acquired = await manager.acquire('anthropic');
    expect(acquired.poolSlug).toBe('openai');
  });
});
