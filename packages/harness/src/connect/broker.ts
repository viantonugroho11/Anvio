import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConnectionGrant, StoredConnection } from '@anvio/core';
import { parseStoredConnection } from '@anvio/core';

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

export class ConnectionStore {
  constructor(
    private readonly rootDir: string,
    private readonly encryptionKey: string,
  ) {}

  stateDir(): string {
    return path.join(this.rootDir, 'connections', '_state');
  }

  private filePath(id: string): string {
    return path.join(this.stateDir(), `${id}.json`);
  }

  connectionId(channel: string, userId: string, service: string): string {
    return `${channel}:${userId}:${service}`;
  }

  async save(connection: Omit<StoredConnection, 'encryptedPayload'> & { payload: string }): Promise<StoredConnection> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = deriveKey(this.encryptionKey, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(connection.payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedPayload = Buffer.concat([salt, iv, tag, encrypted]).toString('base64');

    const stored = parseStoredConnection({
      id: connection.id,
      channel: connection.channel,
      userId: connection.userId,
      service: connection.service,
      encryptedPayload,
      createdAt: connection.createdAt,
      expiresAt: connection.expiresAt,
      threadIds: connection.threadIds,
    });

    await fs.mkdir(this.stateDir(), { recursive: true });
    await fs.writeFile(this.filePath(stored.id), JSON.stringify(stored, null, 2), 'utf-8');
    return stored;
  }

  async read(id: string): Promise<{ meta: StoredConnection; payload: string } | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath(id), 'utf-8'));
      const meta = parseStoredConnection(raw);
      if (new Date(meta.expiresAt).getTime() < Date.now()) return null;
      const data = Buffer.from(meta.encryptedPayload, 'base64');
      const salt = data.subarray(0, 16);
      const iv = data.subarray(16, 28);
      const tag = data.subarray(28, 44);
      const encrypted = data.subarray(44);
      const key = deriveKey(this.encryptionKey, salt);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const payload = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      return { meta, payload };
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }

  async listAll(): Promise<StoredConnection[]> {
    try {
      const files = await fs.readdir(this.stateDir());
      const items: StoredConnection[] = [];
      for (const file of files.filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
        try {
          const raw = JSON.parse(await fs.readFile(path.join(this.stateDir(), file), 'utf-8'));
          const meta = parseStoredConnection(raw);
          if (new Date(meta.expiresAt).getTime() >= Date.now()) items.push(meta);
        } catch {
          // skip corrupt entry
        }
      }
      return items;
    } catch {
      return [];
    }
  }
}

export class ConnectionBroker {
  private readonly grantsFile: string;

  constructor(
    private readonly store: ConnectionStore | null,
    private readonly enabled: boolean,
    private readonly defaultTtlSeconds = 3600,
    rootDir?: string,
  ) {
    this.grantsFile = rootDir
      ? path.join(rootDir, 'connections', '_state', '_grants.json')
      : '';
  }

  isEnabled(): boolean {
    return this.enabled && this.store !== null;
  }

  async putConnection(input: {
    channel: string;
    userId: string;
    service: string;
    payload: string;
    ttlSeconds?: number;
    threadId: string;
  }): Promise<StoredConnection | null> {
    if (!this.store || !this.enabled) return null;
    const now = new Date();
    const ttl = input.ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const id = this.store.connectionId(input.channel, input.userId, input.service);
    const existing = await this.store.read(id);
    const threadIds = existing
      ? [...new Set([...existing.meta.threadIds, input.threadId])]
      : [input.threadId];
    return this.store.save({
      id,
      channel: input.channel,
      userId: input.userId,
      service: input.service,
      createdAt: existing?.meta.createdAt ?? now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      threadIds,
      payload: input.payload,
    });
  }

  async listConnections(userId?: string): Promise<StoredConnection[]> {
    if (!this.store) return [];
    const all = await this.store.listAll();
    return userId ? all.filter((c) => c.userId === userId) : all;
  }

  async revokeConnection(channel: string, userId: string, service: string): Promise<boolean> {
    if (!this.store) return false;
    return this.store.delete(this.store.connectionId(channel, userId, service));
  }

  async grantAccess(grant: ConnectionGrant): Promise<void> {
    if (!this.store || !this.enabled || !this.grantsFile) return;
    const grants = await this.loadGrants();
    grants.push(grant);
    await this.saveGrants(grants);
  }

  async getPayloadForAccess(input: {
    requesterUserId: string;
    channel: string;
    threadId: string;
    service: string;
  }): Promise<string | null> {
    if (!this.store || !this.enabled) return null;

    const owned = await this.store.read(
      this.store.connectionId(input.channel, input.requesterUserId, input.service),
    );
    if (owned && this.threadAllowed(owned.meta.threadIds, input.threadId)) {
      return owned.payload;
    }

    const grants = await this.loadGrants();
    const now = Date.now();
    for (const grant of grants) {
      if (grant.borrowerUserId !== input.requesterUserId) continue;
      if (grant.channel !== input.channel || grant.service !== input.service) continue;
      if (grant.expiresAt && new Date(grant.expiresAt).getTime() < now) continue;
      if (grant.scope === 'thread' && grant.threadId !== input.threadId) continue;

      const ownerConn = await this.store.read(
        this.store.connectionId(input.channel, grant.ownerUserId, input.service),
      );
      if (ownerConn && this.threadAllowed(ownerConn.meta.threadIds, grant.threadId)) {
        return ownerConn.payload;
      }
    }

    return null;
  }

  private threadAllowed(threadIds: string[], threadId: string): boolean {
    return threadIds.length === 0 || threadIds.includes(threadId);
  }

  private async loadGrants(): Promise<ConnectionGrant[]> {
    if (!this.grantsFile) return [];
    try {
      const raw = JSON.parse(await fs.readFile(this.grantsFile, 'utf-8')) as ConnectionGrant[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private async saveGrants(grants: ConnectionGrant[]): Promise<void> {
    await fs.mkdir(path.dirname(this.grantsFile), { recursive: true });
    await fs.writeFile(this.grantsFile, JSON.stringify(grants, null, 2), 'utf-8');
  }
}
