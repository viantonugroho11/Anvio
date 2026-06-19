import type { CredentialPool } from '../schemas/credential.schema.js';

export interface AcquiredCredential {
  poolSlug: string;
  credentialId: string;
  value: string;
  provider: string;
}

export interface CredentialStore {
  encrypt(value: string): string;
  decrypt(blob: string): string;
  put(poolSlug: string, credentialId: string, value: string): Promise<void>;
  get(poolSlug: string, credentialId: string): Promise<string | null>;
}

export interface CredentialPoolManager {
  listPools(): Promise<CredentialPool[]>;
  getPool(slug: string): Promise<CredentialPool | null>;
  addCredential(poolSlug: string, credentialId: string, value: string): Promise<void>;
  acquire(poolSlug: string): Promise<AcquiredCredential>;
  markRateLimited(poolSlug: string, credentialId: string): Promise<void>;
  release(poolSlug: string, credentialId: string): Promise<void>;
  testPool(poolSlug: string): Promise<{ ok: boolean; message: string }>;
}
