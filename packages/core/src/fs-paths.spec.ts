import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveInsideRoot, resolveRealInsideRoot } from './fs-paths.js';

let tmp: string;
let root: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-paths-'));
  root = path.join(tmp, 'ws');
  await fs.mkdir(path.join(root, 'sub'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'ws-other'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'ws-other', 'secret.txt'), 'x');
  await fs.symlink(path.join(tmp, 'ws-other'), path.join(root, 'link-out'));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('resolveInsideRoot', () => {
  it('resolves paths inside the root', () => {
    expect(resolveInsideRoot(root, 'sub/a.txt')).toBe(path.join(root, 'sub', 'a.txt'));
    expect(resolveInsideRoot(root, '.')).toBe(root);
  });

  it('rejects parent traversal and absolute escapes', () => {
    expect(() => resolveInsideRoot(root, '../outside')).toThrow('Path escapes workspace');
    expect(() => resolveInsideRoot(root, '/etc/passwd')).toThrow();
  });

  it('rejects sibling directories that share the root prefix', () => {
    expect(() => resolveInsideRoot(root, '../ws-other/secret.txt')).toThrow();
  });

  it('uses the caller message', () => {
    expect(() => resolveInsideRoot(root, '..', 'nope')).toThrow('nope');
  });
});

describe('resolveRealInsideRoot', () => {
  it('rejects symlinks that point outside the root', async () => {
    await expect(resolveRealInsideRoot(root, 'link-out/secret.txt')).rejects.toThrow();
  });

  it('accepts not-yet-existing paths inside the root', async () => {
    await expect(resolveRealInsideRoot(root, 'sub/new/deep.txt')).resolves.toBe(
      path.join(root, 'sub', 'new', 'deep.txt'),
    );
  });
});
