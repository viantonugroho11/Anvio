import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { CredentialStore } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';

const ALGORITHM = 'aes-256-gcm';

export class EncryptedCredentialStore implements CredentialStore {
  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly passphrase: string,
  ) {}

  encrypt(value: string): string {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, 32);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
  }

  decrypt(blob: string): string {
    const data = Buffer.from(blob, 'base64');
    const salt = data.subarray(0, 16);
    const iv = data.subarray(16, 28);
    const tag = data.subarray(28, 44);
    const encrypted = data.subarray(44);
    const key = scryptSync(this.passphrase, salt, 32);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  private blobKey(poolSlug: string): string {
    return `credentials/encrypted/${poolSlug}.enc.json`;
  }

  async put(poolSlug: string, credentialId: string, value: string): Promise<void> {
    const existing = await this.readBlob(poolSlug);
    existing[credentialId] = this.encrypt(value);
    await this.storage.write(this.blobKey(poolSlug), JSON.stringify(existing, null, 2));
  }

  async get(poolSlug: string, credentialId: string): Promise<string | null> {
    const blob = await this.readBlob(poolSlug);
    const encrypted = blob[credentialId];
    if (!encrypted) return null;
    return this.decrypt(encrypted);
  }

  private async readBlob(poolSlug: string): Promise<Record<string, string>> {
    const raw = await this.storage.read(this.blobKey(poolSlug));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  }
}

export function createEncryptedStore(
  storage: FilesystemStorageProvider,
  passphrase: string,
): EncryptedCredentialStore {
  return new EncryptedCredentialStore(storage, passphrase);
}
