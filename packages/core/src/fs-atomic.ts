import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Write `data` to `file` so readers see either the old or the new content, never
 * a truncated mix: write a sibling temp file, then rename over the target (atomic
 * within one filesystem).
 *
 * The temp name is unique per call. A `${file}.${pid}.tmp` name — used before —
 * collides when two writes to the same file overlap in one process: the second
 * rename finds its temp file already moved and fails with ENOENT.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data, 'utf-8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** Matches temp files left by {@link writeFileAtomic} that have not been renamed yet. */
export const IN_FLIGHT_WRITE_SUFFIX = /\.\d+\.[0-9a-f]{8}\.tmp$/;
