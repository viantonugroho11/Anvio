import { describe, expect, it } from 'vitest';
import { LearningEngine } from '@anvio/learning';
import { ToolGateway } from '@anvio/tools';
import { createMemoryProvider } from '@anvio/memory';
import { Workspace } from '@anvio/workspace';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Phase L6 — runtime skill self-improve', () => {
  it('proposes and auto-promotes skill after successful tool call', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-l6-'));
    await Workspace.init(tmp);
    const ws = await Workspace.open(tmp);
    const memory = createMemoryProvider('filesystem', ws.storage);
    const learning = new LearningEngine(memory, tmp);
    const gateway = await ToolGateway.load(tmp);

    gateway.setOnToolCompleted(async (ctx, call, result) => {
      await learning.onToolUseCompleted({
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        toolName: call.name,
        outcome: JSON.stringify(result.output ?? null),
      });
    });

    const result = await gateway.call(
      {
        name: 'anvio_tools__web_fetch',
        arguments: { url: 'https://example.com' },
      },
      { sessionId: 's1', agentId: 'architect' },
    );

    expect(result.status).toBe('completed');

    const drafts = await learning.listDrafts();
    expect(drafts.length).toBeGreaterThan(0);

    const promoted = await fs.readdir(path.join(tmp, 'skills'));
    const skillFiles = promoted.filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    expect(skillFiles.length).toBeGreaterThan(0);
  });

  it('skips runtime learning when soul evolution disabled', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-l6-skip-'));
    await Workspace.init(tmp);
    const ws = await Workspace.open(tmp);
    const memory = createMemoryProvider('filesystem', ws.storage);
    const learning = new LearningEngine(memory, tmp);

    const outcome = await learning.onToolUseCompleted({
      sessionId: 's1',
      agentId: 'architect',
      toolName: 'anvio_tools__web_fetch',
      outcome: 'Fetched page content successfully with title Example Domain',
      soul: {
        apiVersion: 'anvio.io/v1',
        kind: 'Soul',
        metadata: { slug: 'test-soul', version: '1.0.0' },
        spec: {
          name: 'Test',
          identity: { name: 'Test', role: 'test' },
          evolution: { allowAutoUpdate: false, requireApproval: false },
        },
      },
    });

    expect(outcome.skipped).toBe('soul evolution disabled');
    const drafts = await learning.listDrafts();
    expect(drafts).toHaveLength(0);
  });
});
