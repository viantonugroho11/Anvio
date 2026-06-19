import type {
  AcquiredCredential,
  CredentialPool,
  CredentialPoolManager,
} from '@anvio/core';
import { AnvioError, parseCredentialPool } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import type { EncryptedCredentialStore } from './encrypted-store.js';
import { createEncryptedStore } from './encrypted-store.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

interface PoolState {
  roundRobinIndex: number;
  usage: Map<string, number>;
}

export class CredentialPoolManagerImpl implements CredentialPoolManager {
  private readonly state = new Map<string, PoolState>();

  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly store: EncryptedCredentialStore,
  ) {}

  private poolKey(slug: string): string {
    return `credentials/pools/${slug}.yaml`;
  }

  async listPools(): Promise<CredentialPool[]> {
    const files = await this.storage.list('credentials/pools');
    const pools: CredentialPool[] = [];
    for (const file of files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      pools.push(parseCredentialPool(parseYaml(raw)));
    }
    return pools;
  }

  async getPool(slug: string): Promise<CredentialPool | null> {
    const raw = await this.storage.read(this.poolKey(slug));
    if (!raw) return null;
    return parseCredentialPool(parseYaml(raw));
  }

  async savePool(pool: CredentialPool): Promise<void> {
    await this.storage.write(this.poolKey(pool.metadata.slug), stringifyYaml(pool));
  }

  async addCredential(poolSlug: string, credentialId: string, value: string): Promise<void> {
    let pool = await this.getPool(poolSlug);
    if (!pool) {
      pool = {
        apiVersion: 'anvio.io/v1',
        kind: 'CredentialPool',
        metadata: { slug: poolSlug },
        spec: {
          provider: poolSlug,
          strategy: 'round_robin',
          credentials: [],
          rotation: { onRateLimit: 'rotate', cooldownSeconds: 60 },
          failover: { enabled: false },
        },
      };
    }

    await this.store.put(poolSlug, credentialId, value);

    const existing = pool.spec.credentials.find((c) => c.id === credentialId);
    if (!existing) {
      pool.spec.credentials.push({
        id: credentialId,
        encryptedRef: `encrypted/${poolSlug}.enc.json#${credentialId}`,
        status: 'active',
      });
    } else {
      existing.status = 'active';
      existing.rateLimitedUntil = undefined;
    }

    await this.savePool(pool);
  }

  async acquire(poolSlug: string): Promise<AcquiredCredential> {
    const pool = await this.getPool(poolSlug);
    if (!pool) {
      throw new AnvioError('NOT_FOUND', `Credential pool not found: ${poolSlug}`);
    }

    const credential = this.selectCredential(pool);
    if (!credential) {
      return this.tryFailover(poolSlug, pool);
    }

    const value = await this.store.get(poolSlug, credential.id);
    if (!value) {
      throw new AnvioError('NOT_FOUND', `Credential value missing: ${poolSlug}/${credential.id}`);
    }

    this.trackUsage(pool.metadata.slug, credential.id);

    return {
      poolSlug: pool.metadata.slug,
      credentialId: credential.id,
      value,
      provider: pool.spec.provider,
    };
  }

  async markRateLimited(poolSlug: string, credentialId: string): Promise<void> {
    const pool = await this.getPool(poolSlug);
    if (!pool) return;

    const entry = pool.spec.credentials.find((c) => c.id === credentialId);
    if (!entry) return;

    entry.status = 'rate_limited';
    const cooldown = pool.spec.rotation.cooldownSeconds ?? 60;
    entry.rateLimitedUntil = new Date(Date.now() + cooldown * 1000).toISOString();
    await this.savePool(pool);
  }

  async release(_poolSlug: string, _credentialId: string): Promise<void> {
    // Round-robin does not hold locks; no-op for Level 1
  }

  async testPool(poolSlug: string): Promise<{ ok: boolean; message: string }> {
    try {
      const cred = await this.acquire(poolSlug);
      const masked = `${cred.value.slice(0, 4)}...`;
      return { ok: true, message: `Acquired ${cred.credentialId} (${masked})` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  private selectCredential(pool: CredentialPool) {
    const now = Date.now();
    const active = pool.spec.credentials.filter((c) => {
      if (c.status === 'disabled') return false;
      if (c.status === 'rate_limited' && c.rateLimitedUntil) {
        if (new Date(c.rateLimitedUntil).getTime() > now) return false;
        c.status = 'active';
        c.rateLimitedUntil = undefined;
      }
      return c.status === 'active' || c.status === 'rate_limited';
    });

    if (active.length === 0) return null;

    const state = this.state.get(pool.metadata.slug) ?? { roundRobinIndex: 0, usage: new Map() };

    switch (pool.spec.strategy) {
      case 'random': {
        return active[Math.floor(Math.random() * active.length)]!;
      }
      case 'least_used': {
        return active.reduce((best, current) => {
          const bestUse = state.usage.get(best.id) ?? 0;
          const currentUse = state.usage.get(current.id) ?? 0;
          return currentUse < bestUse ? current : best;
        });
      }
      case 'round_robin':
      default: {
        const picked = active[state.roundRobinIndex % active.length]!;
        state.roundRobinIndex = (state.roundRobinIndex + 1) % active.length;
        this.state.set(pool.metadata.slug, state);
        return picked;
      }
    }
  }

  private trackUsage(poolSlug: string, credentialId: string): void {
    const state = this.state.get(poolSlug) ?? { roundRobinIndex: 0, usage: new Map() };
    state.usage.set(credentialId, (state.usage.get(credentialId) ?? 0) + 1);
    this.state.set(poolSlug, state);
  }

  private async tryFailover(
    poolSlug: string,
    pool?: CredentialPool | null,
  ): Promise<AcquiredCredential> {
    const fallback = pool?.spec.failover;
    if (fallback?.enabled && fallback.fallbackPool) {
      return this.acquire(fallback.fallbackPool);
    }
    throw new AnvioError('NOT_FOUND', `No available credentials in pool: ${poolSlug}`);
  }
}

export function createCredentialPoolManager(
  storage: FilesystemStorageProvider,
  passphrase: string,
): CredentialPoolManager {
  return new CredentialPoolManagerImpl(storage, createEncryptedStore(storage, passphrase));
}
