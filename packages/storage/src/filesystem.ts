import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider } from '@anvio/core';

export class FilesystemStorageProvider implements StorageProvider {
  readonly providerId = 'filesystem';

  constructor(private readonly rootDir: string) {}

  get rootPath(): string {
    return this.rootDir;
  }

  private resolve(key: string): string {
    const resolved = path.resolve(this.rootDir, key);
    if (!resolved.startsWith(path.resolve(this.rootDir))) {
      throw new Error(`Path traversal denied: ${key}`);
    }
    return resolved;
  }

  async read(key: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(key), 'utf-8');
    } catch {
      return null;
    }
  }

  async write(key: string, data: string): Promise<void> {
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data, 'utf-8');
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch {
      /* ignore missing */
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => path.join(prefix, e.name).replace(/\\/g, '/'));
    } catch {
      return [];
    }
  }

  async readJson<T>(key: string): Promise<T | null> {
    const raw = await this.read(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async writeJson(key: string, data: unknown): Promise<void> {
    await this.write(key, JSON.stringify(data, null, 2));
  }
}

export function createStorageProvider(
  provider: string,
  options: { basePath: string; connectionString?: string },
): StorageProvider {
  switch (provider) {
    case 'filesystem':
      return new FilesystemStorageProvider(options.basePath);
    case 'sqlite':
    case 'postgresql':
    case 's3':
      throw new Error(
        `Storage provider "${provider}" is Level 2+ — use filesystem for local-first mode`,
      );
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}
