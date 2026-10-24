import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider } from '@anvio/core';
import { IN_FLIGHT_WRITE_SUFFIX, resolveInsideRoot, writeFileAtomic } from '@anvio/core';

/** Absent file or a path component that is not a directory: both mean "no such key". */
function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export class FilesystemStorageProvider implements StorageProvider {
  readonly providerId = 'filesystem';

  constructor(private readonly rootDir: string) {}

  get rootPath(): string {
    return this.rootDir;
  }

  private resolve(key: string): string {
    return resolveInsideRoot(this.rootDir, key, `Path traversal denied: ${key}`);
  }

  /**
   * `null` only when the key does not exist. Permission, I/O and traversal errors
   * used to be reported as "missing" too, which made a broken session file look
   * like a new, empty session (audit CQ-012).
   */
  async read(key: string): Promise<string | null> {
    const filePath = this.resolve(key);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /**
   * Write via a temp file and rename, so a crash mid-write leaves the previous
   * content instead of a truncated file (audit CQ-014). `rename` is atomic within
   * one filesystem, and the temp file sits next to the target to guarantee that.
   */
  async write(key: string, data: string): Promise<void> {
    await writeFileAtomic(this.resolve(key), data);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolve(key);
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolve(prefix);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && !IN_FLIGHT_WRITE_SUFFIX.test(e.name))
        .map((e) => path.join(prefix, e.name).replace(/\\/g, '/'));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
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
