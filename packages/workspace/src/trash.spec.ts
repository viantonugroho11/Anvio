import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { moveToTrash, restoreFromTrash, listTrash, pruneTrash } from './trash.js';

async function mkTempWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-trash-'));
  await fs.mkdir(path.join(root, 'agents'), { recursive: true });
  await fs.mkdir(path.join(root, 'workflows'), { recursive: true });
  return root;
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

describe('workspace trash', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('moves an agent md file into _trash/agent/ and reports restore command', async () => {
    await writeFile(root, 'agents/planner.md', '# planner');
    const result = await moveToTrash(root, 'agent', 'planner');
    expect(result.entry.primitive).toBe('agent');
    expect(result.entry.slug).toBe('planner');
    expect(result.entry.ext).toBe('.md');
    expect(result.entry.entryName).toMatch(/^planner-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/);
    expect(result.restoreCommand).toBe(`anvio trash restore agent ${result.entry.entryName}`);
    await expect(fs.access(path.join(root, 'agents/planner.md'))).rejects.toBeDefined();
    await expect(fs.access(result.entry.path)).resolves.toBeUndefined();
  });

  it('discovers yaml extension for workflows', async () => {
    await writeFile(root, 'workflows/ingest.yaml', 'nodes: []');
    const result = await moveToTrash(root, 'workflow', 'ingest');
    expect(result.entry.ext).toBe('.yaml');
    expect(result.entry.entryName).toMatch(/\.yaml$/);
  });

  it('throws when the source file is missing', async () => {
    await expect(moveToTrash(root, 'agent', 'ghost')).rejects.toThrow();
  });

  it('restores from trash to the original slug and refuses overwrite without --force', async () => {
    await writeFile(root, 'agents/planner.md', 'v1');
    const { entry } = await moveToTrash(root, 'agent', 'planner');
    const restored = await restoreFromTrash(root, 'agent', entry.entryName);
    expect(restored.destPath).toBe(path.join(root, 'agents/planner.md'));
    expect(restored.overwritten).toBe(false);
    expect(await fs.readFile(restored.destPath, 'utf-8')).toBe('v1');

    // Overwrite path — need a live file to overwrite AND a trashed entry.
    await writeFile(root, 'agents/planner.md', 'v2-live');
    const t2 = await moveToTrash(root, 'agent', 'planner'); // trashes v2-live
    await writeFile(root, 'agents/planner.md', 'v3-live'); // new live file blocks restore
    await expect(
      restoreFromTrash(root, 'agent', t2.entry.entryName),
    ).rejects.toThrow(/Refusing to overwrite/);
    const forced = await restoreFromTrash(root, 'agent', t2.entry.entryName, { force: true });
    expect(forced.overwritten).toBe(true);
    expect(await fs.readFile(restored.destPath, 'utf-8')).toBe('v2-live');
  });

  it('rejects a malformed entry name', async () => {
    await expect(restoreFromTrash(root, 'agent', 'not-a-real-entry.md')).rejects.toThrow(
      /Not a trash entry name/,
    );
  });

  it('listTrash returns newest first and filters by primitive', async () => {
    await writeFile(root, 'agents/a.md', 'a');
    await writeFile(root, 'agents/b.md', 'b');
    await writeFile(root, 'workflows/w.yaml', 'w');
    await moveToTrash(root, 'agent', 'a');
    await new Promise((r) => setTimeout(r, 10));
    await moveToTrash(root, 'workflow', 'w');
    await new Promise((r) => setTimeout(r, 10));
    await moveToTrash(root, 'agent', 'b');

    const all = await listTrash(root);
    expect(all.map((e) => `${e.primitive}:${e.slug}`)).toEqual([
      'agent:b',
      'workflow:w',
      'agent:a',
    ]);

    const agents = await listTrash(root, 'agent');
    expect(agents.map((e) => e.slug)).toEqual(['b', 'a']);
  });

  it('pruneTrash removes entries older than the cutoff', async () => {
    await writeFile(root, 'agents/old.md', 'old');
    const { entry } = await moveToTrash(root, 'agent', 'old');
    // Backdate the trashed file's name to simulate age. moveToTrash uses
    // real time; rewrite the entry with a timestamp 40 days back.
    const backdated = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/[:.]/g, '-');
    const newName = `old-${backdated}.md`;
    await fs.rename(entry.path, path.join(path.dirname(entry.path), newName));

    const dry = await pruneTrash(root, { olderThanDays: 30, dryRun: true });
    expect(dry.removed).toHaveLength(1);
    await expect(fs.access(path.join(path.dirname(entry.path), newName))).resolves.toBeUndefined();

    const real = await pruneTrash(root, { olderThanDays: 30 });
    expect(real.removed).toHaveLength(1);
    await expect(fs.access(path.join(path.dirname(entry.path), newName))).rejects.toBeDefined();
  });
});
