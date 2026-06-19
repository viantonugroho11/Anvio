import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoredConnection } from '@anvio/core';
import { parseStoredConnection } from '@anvio/core';

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

export class ConnectionStore {
  constructor(
    private readonly rootDir: string,
    private readonly encryptionKey: string,
  ) {}

  private filePath(id: string): string {
    return path.join(this.rootDir, 'connections', '_state', `${id}.json`);
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

    await fs.mkdir(path.dirname(this.filePath(stored.id)), { recursive: true });
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
}

export class ConnectionBroker {
  constructor(
    private readonly store: ConnectionStore | null,
    private readonly enabled: boolean,
  ) {}

  isEnabled(): boolean {
    return this.enabled && this.store !== null;
  }

  async putConnection(input: {
    channel: string;
    userId: string;
    service: string;
    payload: string;
    ttlSeconds: number;
    threadId: string;
  }): Promise<StoredConnection | null> {
    if (!this.store || !this.enabled) return null;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    return this.store.save({
      id: `${input.channel}:${input.userId}:${input.service}`,
      channel: input.channel,
      userId: input.userId,
      service: input.service,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      threadIds: [input.threadId],
      payload: input.payload,
    });
  }
}
