import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Workspace } from './index.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-open-'));
  dirs.push(dir);
  return dir;
}

describe('Workspace.open config loading', () => {
  it('uses the defaults when anvio.yaml does not exist', async () => {
    const dir = await tempWorkspace();
    const ws = await Workspace.open(dir);
    expect(ws.config.metadata.name).toBe('default');
  });

  it('refuses to open with an anvio.yaml that does not parse instead of silently using defaults', async () => {
    const dir = await tempWorkspace();
    await fs.writeFile(
      path.join(dir, 'anvio.yaml'),
      'apiVersion: anvio.io/v1\nkind: Workspace\nspec: [broken',
    );
    await expect(Workspace.open(dir)).rejects.toThrow(/Invalid workspace config .*anvio\.yaml/);
  });

  it('refuses to open with an anvio.yaml that fails schema validation', async () => {
    const dir = await tempWorkspace();
    await fs.writeFile(
      path.join(dir, 'anvio.yaml'),
      'apiVersion: anvio.io/v1\nkind: NotAWorkspace\n',
    );
    await expect(Workspace.open(dir)).rejects.toThrow(/Invalid workspace config/);
  });
});
