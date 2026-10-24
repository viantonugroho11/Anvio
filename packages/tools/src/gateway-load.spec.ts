import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolGateway } from './gateway.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-gw-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function writeGateway(body: string): Promise<void> {
  await fs.mkdir(path.join(root, 'tools'), { recursive: true });
  await fs.writeFile(path.join(root, 'tools/gateway.yaml'), body);
}

describe('ToolGateway.load', () => {
  it('uses the built-in defaults when the file does not exist', async () => {
    const gw = await ToolGateway.load(root);
    expect(gw.listTools()).toContain('anvio_tools__web_fetch');
    expect(gw.spec.network.allowPrivateNetwork).toBe(false);
  });

  it('fails instead of silently applying defaults when the file is invalid', async () => {
    await writeGateway(
      'apiVersion: anvio.io/v1\nkind: ToolGateway\nmetadata: {}\nspec:\n  tools:\n    http_request:\n      enabled: "nope"\n',
    );
    await expect(ToolGateway.load(root)).rejects.toThrow(/Invalid tool gateway config/);
  });

  it('fails on YAML syntax errors', async () => {
    await writeGateway('spec: [unclosed');
    await expect(ToolGateway.load(root)).rejects.toThrow(/Invalid tool gateway config/);
  });

  it('respects a valid file that disables a default tool', async () => {
    await writeGateway(
      'apiVersion: anvio.io/v1\nkind: ToolGateway\nmetadata: {}\nspec:\n  tools:\n    http_request:\n      enabled: false\n',
    );
    const gw = await ToolGateway.load(root);
    expect(gw.listTools()).not.toContain('anvio_tools__http_request');
  });
});

describe('ToolGateway.call', () => {
  it('keeps a completed result when the onToolCompleted hook throws', async () => {
    const gw = await ToolGateway.load(root);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    gw.setOnToolCompleted(() => {
      throw new Error('observer broke');
    });
    const result = await gw.call(
      { name: 'anvio_tools__datetime_now', arguments: {} },
      { sessionId: 's1', agentId: 'a1' },
    );
    expect(result.status).toBe('completed');
    expect(errors).toHaveBeenCalled();
  });

  it('does not evaluate execute_code in-process without an executor', async () => {
    await writeGateway(
      'apiVersion: anvio.io/v1\nkind: ToolGateway\nmetadata: {}\nspec:\n  tools:\n    execute_code:\n      enabled: true\n',
    );
    const gw = await ToolGateway.load(root);
    (globalThis as { __anvioEvalProbe?: boolean }).__anvioEvalProbe = false;
    const result = await gw.call({
      name: 'anvio_tools__execute_code',
      arguments: { code: 'globalThis.__anvioEvalProbe = true; return 1' },
    });
    expect(result.status).toBe('failed');
    expect((globalThis as { __anvioEvalProbe?: boolean }).__anvioEvalProbe).toBe(false);
  });
});
