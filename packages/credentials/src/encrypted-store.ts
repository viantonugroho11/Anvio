import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'node:crypto';
import { promisify } from 'node:util';
import type { CredentialStore } from '@anvio/core';
import { KeyedSerialQueue } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';

const ALGORITHM = 'aes-256-gcm';
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Derived keys kept per salt; scrypt is deliberately slow (tens of ms per call). */
const KEY_CACHE_SIZE = 256;

export class EncryptedCredentialStore implements CredentialStore {
  private readonly keyCache = new Map<string, Buffer>();
  /** put() is read-modify-write on one blob per pool; concurrent puts lost credentials. */
  private readonly poolWrites = new KeyedSerialQueue();

  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly passphrase: string,
  ) {}

  /** Synchronous form kept for callers of the original API; prefer `put`/`get`. */
  encrypt(value: string): string {
    const salt = randomBytes(16);
    return this.seal(
      value,
      salt,
      this.cachedKey(salt) ?? this.remember(salt, scryptSync(this.passphrase, salt, 32)),
    );
  }

  /** Synchronous form kept for callers of the original API; prefer `put`/`get`. */
  decrypt(blob: string): string {
    const parts = split(blob);
    return this.open(
      parts,
      this.cachedKey(parts.salt) ??
        this.remember(parts.salt, scryptSync(this.passphrase, parts.salt, 32)),
    );
  }

  private blobKey(poolSlug: string): string {
    return `credentials/encrypted/${poolSlug}.enc.json`;
  }

  async put(poolSlug: string, credentialId: string, value: string): Promise<void> {
    const salt = randomBytes(16);
    const sealed = this.seal(value, salt, await this.deriveKey(salt));
    await this.poolWrites.run(poolSlug, async () => {
      const existing = await this.readBlob(poolSlug);
      existing[credentialId] = sealed;
      await this.storage.write(this.blobKey(poolSlug), JSON.stringify(existing, null, 2));
    });
  }

  async get(poolSlug: string, credentialId: string): Promise<string | null> {
    const blob = await this.readBlob(poolSlug);
    const encrypted = blob[credentialId];
    if (!encrypted) return null;
    const parts = split(encrypted);
    return this.open(parts, await this.deriveKey(parts.salt));
  }

  /**
   * Async scrypt runs on the libuv threadpool. `scryptSync` on every get/put
   * blocked the event loop — every channel and HTTP request — for each
   * credential read during pool rotation (audit CQ-031).
   */
  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return (
      this.cachedKey(salt) ?? this.remember(salt, await scryptAsync(this.passphrase, salt, 32))
    );
  }

  private cachedKey(salt: Buffer): Buffer | undefined {
    return this.keyCache.get(salt.toString('hex'));
  }

  private remember(salt: Buffer, key: Buffer): Buffer {
    this.keyCache.set(salt.toString('hex'), key);
    if (this.keyCache.size > KEY_CACHE_SIZE) {
      const oldest = this.keyCache.keys().next().value;
      if (oldest !== undefined) this.keyCache.delete(oldest);
    }
    return key;
  }

  private seal(value: string, salt: Buffer, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
  }

  private open(parts: SealedParts, key: Buffer): string {
    const decipher = createDecipheriv(ALGORITHM, key, parts.iv);
    decipher.setAuthTag(parts.tag);
    return Buffer.concat([decipher.update(parts.encrypted), decipher.final()]).toString('utf8');
  }

  private async readBlob(poolSlug: string): Promise<Record<string, string>> {
    const raw = await this.storage.read(this.blobKey(poolSlug));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  }
}

interface SealedParts {
  salt: Buffer;
  iv: Buffer;
  tag: Buffer;
  encrypted: Buffer;
}

/** Format (unchanged): base64(salt[16] | iv[12] | tag[16] | ciphertext). */
function split(blob: string): SealedParts {
  const data = Buffer.from(blob, 'base64');
  return {
    salt: data.subarray(0, 16),
    iv: data.subarray(16, 28),
    tag: data.subarray(28, 44),
    encrypted: data.subarray(44),
  };
}

export function createEncryptedStore(
  storage: FilesystemStorageProvider,
  passphrase: string,
): EncryptedCredentialStore {
  return new EncryptedCredentialStore(storage, passphrase);
}
