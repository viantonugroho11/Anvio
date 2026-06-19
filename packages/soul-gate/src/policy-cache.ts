import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SoulPolicy } from '@anvio/core';
import { parseSoulPolicy } from '@anvio/core';

export function hashSoulSource(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

export async function readCachedPolicy(
  cacheDir: string,
  sourceHash: string,
): Promise<SoulPolicy | null> {
  const filePath = path.join(cacheDir, `soul.${sourceHash}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return parseSoulPolicy(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCachedPolicy(
  cacheDir: string,
  sourceHash: string,
  policy: SoulPolicy,
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, `soul.${sourceHash}.json`);
  await fs.writeFile(filePath, JSON.stringify(policy, null, 2), 'utf-8');
}
