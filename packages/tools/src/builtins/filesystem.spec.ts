import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendFile,
  editFile,
  fileDelete,
  listDir,
  pathExists,
} from './filesystem.js';

describe('filesystem builtins', () => {
  it('listDir returns files and directories', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-fs-'));
    await fs.mkdir(path.join(tmp, 'docs'));
    await fs.writeFile(path.join(tmp, 'readme.md'), '# Hi');
    const result = await listDir(tmp);
    expect(result.entries.some((e) => e.name === 'docs' && e.type === 'dir')).toBe(true);
    expect(result.entries.some((e) => e.name === 'readme.md' && e.type === 'file')).toBe(true);
  });

  it('editFile replaces old_string once', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-edit-'));
    await fs.writeFile(path.join(tmp, 'a.txt'), 'hello world');
    const result = await editFile(tmp, 'a.txt', 'world', 'Anvio');
    expect(result.replacements).toBe(1);
    const content = await fs.readFile(path.join(tmp, 'a.txt'), 'utf-8');
    expect(content).toBe('hello Anvio');
  });

  it('pathExists detects files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-exists-'));
    await fs.writeFile(path.join(tmp, 'x.md'), 'x');
    expect((await pathExists(tmp, 'x.md')).exists).toBe(true);
    expect((await pathExists(tmp, 'missing.md')).exists).toBe(false);
  });

  it('appendFile and fileDelete work under workspace', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-append-'));
    await fs.writeFile(path.join(tmp, 'log.txt'), 'a');
    await appendFile(tmp, 'log.txt', 'b');
    expect(await fs.readFile(path.join(tmp, 'log.txt'), 'utf-8')).toBe('ab');
    await fileDelete(tmp, 'log.txt');
    expect((await pathExists(tmp, 'log.txt')).exists).toBe(false);
  });
});
