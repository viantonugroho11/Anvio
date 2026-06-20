import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageProvider } from '@anvio/core';

/** Append one JSON object as a line to a jsonl audit file. */
export async function appendJsonl(
  storage: StorageProvider,
  relativePath: string,
  record: Record<string, unknown>,
): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  const root = (storage as { rootPath?: string }).rootPath;
  if (root) {
    const filePath = path.resolve(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, line, 'utf-8');
    return;
  }

  const existing = (await storage.read(relativePath)) ?? '';
  await storage.write(relativePath, existing + line);
}
