import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  scaffoldPrimitive,
  editPrimitive,
  removePrimitive,
  readMutationAudit,
  resolvePrimitivePath,
} from './mutations.js';

async function mkWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'anvio-mut-'));
}

describe('workspace mutations', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkWorkspace();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('scaffolds a new agent with frontmatter template and audits it', async () => {
    const r = await scaffoldPrimitive(root, 'agent', 'planner', { actor: 'me' });
    expect(r.path).toBe(path.join(root, 'agents/planner.md'));
    const contents = await fs.readFile(r.path, 'utf-8');
    expect(contents).toMatch(/^---/);
    expect(contents).toMatch(/name: planner/);
    expect(contents).toMatch(/# planner/);

    const audit = await readMutationAudit(root);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: 'me',
      primitive: 'agent',
      slug: 'planner',
      action: 'new',
      hashAfter: r.hashAfter,
    });
  });

  it('refuses to overwrite without --force but trashes the old file when forced', async () => {
    await scaffoldPrimitive(root, 'workflow', 'ingest', { actor: 'me' });
    await expect(
      scaffoldPrimitive(root, 'workflow', 'ingest', { actor: 'me' }),
    ).rejects.toThrow(/Already exists/);
    const forced = await scaffoldPrimitive(root, 'workflow', 'ingest', {
      actor: 'me',
      force: true,
      body: 'apiVersion: anvio.io/v1\nkind: Workflow\n',
    });
    expect(forced.path).toBe(path.join(root, 'workflows/ingest.yaml'));
    const trash = await fs.readdir(path.join(root, '_trash/workflow'));
    expect(trash).toHaveLength(1);
  });

  it('rejects an invalid slug', async () => {
    await expect(
      scaffoldPrimitive(root, 'agent', 'has spaces!', { actor: 'me' }),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('edits an existing primitive, trashing the previous version', async () => {
    await scaffoldPrimitive(root, 'agent', 'planner', { actor: 'me' });
    const original = await fs.readFile(path.join(root, 'agents/planner.md'), 'utf-8');
    const result = await editPrimitive(root, 'agent', 'planner', {
      actor: 'me',
      body: '---\nname: planner\n---\n\n# edited\n',
    });
    expect(result.hashBefore).not.toBe(result.hashAfter);
    const trash = await fs.readdir(path.join(root, '_trash/agent'));
    expect(trash).toHaveLength(1);
    const trashed = await fs.readFile(path.join(root, '_trash/agent', trash[0]), 'utf-8');
    expect(trashed).toBe(original);

    const audit = await readMutationAudit(root);
    expect(audit.map((r) => r.action)).toEqual(['new', 'edit']);
    expect(audit[1].hashBefore).toBeDefined();
  });

  it('editPrimitive throws when the target does not exist', async () => {
    await expect(
      editPrimitive(root, 'agent', 'ghost', { actor: 'me', body: 'x' }),
    ).rejects.toThrow(/Not found/);
  });

  it('removePrimitive soft-deletes via trash and records the hash', async () => {
    await scaffoldPrimitive(root, 'goal', 'ship-track2', { actor: 'me' });
    const result = await removePrimitive(root, 'goal', 'ship-track2', {
      actor: 'me',
      reason: 'obsolete',
    });
    expect(result.trash.entry.slug).toBe('ship-track2');
    expect(await resolvePrimitivePath(root, 'goal', 'ship-track2')).toBeNull();
    const audit = await readMutationAudit(root);
    expect(audit.at(-1)).toMatchObject({
      action: 'rm',
      primitive: 'goal',
      slug: 'ship-track2',
      reason: 'obsolete',
    });
  });

  it('readMutationAudit tolerates a missing log', async () => {
    const rows = await readMutationAudit(root);
    expect(rows).toEqual([]);
  });
});
