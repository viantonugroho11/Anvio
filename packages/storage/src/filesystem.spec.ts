import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesystemStorageProvider } from './filesystem.js';
import { appendJsonl } from './jsonl.js';

let tmp: string;
let root: string;
let storage: FilesystemStorageProvider;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-storage-'));
  root = path.join(tmp, 'ws');
  await fs.mkdir(root);
  await fs.mkdir(path.join(tmp, 'ws-sibling'));
  storage = new FilesystemStorageProvider(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('FilesystemStorageProvider', () => {
  it('round-trips text and JSON', async () => {
    await storage.write('sessions/a.json', 'hello');
    expect(await storage.read('sessions/a.json')).toBe('hello');
    await storage.writeJson('state/x.json', { a: 1 });
    expect(await storage.readJson('state/x.json')).toEqual({ a: 1 });
    expect(await storage.list('sessions')).toEqual(['sessions/a.json']);
  });

  it('returns null / false / [] only for missing keys', async () => {
    expect(await storage.read('nope.json')).toBeNull();
    expect(await storage.exists('nope.json')).toBe(false);
    expect(await storage.list('nope')).toEqual([]);
    await expect(storage.delete('nope.json')).resolves.toBeUndefined();
  });

  it('surfaces non-missing read errors instead of reporting the key as absent', async () => {
    await fs.mkdir(path.join(root, 'dir.json'));
    await expect(storage.read('dir.json')).rejects.toThrow();
  });

  it('rejects traversal, including sibling directories sharing the root prefix', async () => {
    await expect(storage.write('../ws-sibling/evil.json', 'x')).rejects.toThrow(
      /Path traversal denied/,
    );
    await expect(storage.read('../outside.json')).rejects.toThrow(/Path traversal denied/);
    await expect(appendJsonl(storage, '../ws-sibling/a.jsonl', { a: 1 })).rejects.toThrow(
      /Path traversal denied/,
    );
  });

  it('keeps the previous content when a write fails before the rename', async () => {
    await storage.write('sessions/a.json', 'old');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));
    await expect(storage.write('sessions/a.json', 'new')).rejects.toThrow('disk full');
    expect(await storage.read('sessions/a.json')).toBe('old');
    const leftovers = (await fs.readdir(path.join(root, 'sessions'))).filter((f) =>
      f.endsWith('.tmp'),
    );
    expect(leftovers).toEqual([]);
  });

  it('hides in-flight temp files from list()', async () => {
    await storage.write('sessions/a.json', 'x');
    await fs.writeFile(path.join(root, 'sessions', 'b.json.123.deadbeef.tmp'), 'partial');
    expect(await storage.list('sessions')).toEqual(['sessions/a.json']);
  });
});
