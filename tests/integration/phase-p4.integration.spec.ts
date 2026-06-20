import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '@anvio/workspace';
import { ToolGateway, buildModelToolDefinitions, globFiles, grepSearch } from '@anvio/tools';

describe('Phase P4 — native tools & expanded gateway', () => {
  it('lists expanded workspace tools by default', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p4-'));
    await Workspace.init(tmp);
    const gateway = await ToolGateway.load(tmp);
    const tools = gateway.listTools();
    expect(tools).toContain('anvio_tools__glob_files');
    expect(tools).toContain('anvio_tools__grep_search');
    expect(tools).toContain('anvio_tools__file_read');
  });

  it('builds model tool definitions for native API', async () => {
    const defs = buildModelToolDefinitions(['anvio_tools__glob_files', 'anvio_tools__web_fetch']);
    expect(defs).toHaveLength(2);
    expect(defs[0]?.inputSchema).toBeDefined();
    expect(defs[0]?.description).toContain('Glob');
  });

  it('glob_files finds markdown under workspace', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p4-glob-'));
    await fs.mkdir(path.join(tmp, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'docs/readme.md'), '# Hello');
    const result = await globFiles(tmp, '**/*.md');
    expect(result.files.some((f) => f.endsWith('readme.md'))).toBe(true);
  });

  it('grep_search finds pattern in workspace files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p4-grep-'));
    await fs.writeFile(path.join(tmp, 'note.md'), 'Anvio tool gateway expansion');
    const result = await grepSearch(tmp, 'tool gateway');
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('gateway exposes getModelToolDefinitions', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p4-defs-'));
    await Workspace.init(tmp);
    const gateway = await ToolGateway.load(tmp);
    const defs = gateway.getModelToolDefinitions();
    expect(defs.length).toBeGreaterThan(3);
  });
});
