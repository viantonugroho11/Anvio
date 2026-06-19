import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCodeExecutor } from '@anvio/execution';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';

describe('Code Execution Engine', () => {
  let tmpDir: string;
  let executor: ReturnType<typeof createCodeExecutor>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-exec-'));
    await Workspace.init(tmpDir);
    executor = createCodeExecutor({
      storage: new FilesystemStorageProvider(tmpDir),
      workspaceRoot: tmpDir,
      defaultTimeoutMs: 5000,
      networkEnabled: false,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('executes python and returns stdout', async () => {
    const result = await executor.execute({
      runtime: 'python',
      code: 'print("hello-exec")',
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-exec');
    expect(result.auditId).toMatch(/^exec-/);
  });

  it('timeout kills runaway process', async () => {
    const result = await executor.execute({
      runtime: 'python',
      code: 'import time; time.sleep(10)',
      timeoutMs: 500,
    });
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('timed out');
  });

  it('audits execution to workspace', async () => {
    const result = await executor.execute({
      runtime: 'shell',
      code: 'echo audited',
      timeoutMs: 5000,
    });
    const auditPath = path.join(tmpDir, 'audit/executions', `${result.auditId}.yaml`);
    const raw = await fs.readFile(auditPath, 'utf8');
    expect(raw).toContain('audited');
    expect(raw).toContain(result.auditId);
  });

  it('logs failure with auditId', async () => {
    const result = await executor.execute({
      runtime: 'python',
      code: 'raise RuntimeError("boom")',
      timeoutMs: 5000,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.auditId).toMatch(/^exec-/);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
