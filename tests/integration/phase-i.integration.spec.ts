import { describe, expect, it } from 'vitest';
import { DagExecutor, createWorkflowRegistry } from '@anvio/workflows';
import { TeamsChannel, MatrixChannel, ChannelSessionBridge } from '@anvio/channels';
import { SshRuntimeProvider } from '@anvio/runtimes';
import { VoicePipeline } from '@anvio/voice';
import { Workspace } from '@anvio/workspace';
import type { SessionStore, StoredSession } from '@anvio/core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const EXAMPLE_DAG = `# Example DAG workflow
apiVersion: anvio.io/v1
kind: Workflow
metadata:
  slug: example-dag
  version: "1.0.0"
spec:
  description: Test DAG
  inputs:
    topic:
      type: string
      default: architecture
  nodes:
    - id: gather-a
      type: transform
      template: "Finding A for {{inputs.topic}}"
    - id: gather-b
      type: transform
      template: "Finding B for {{inputs.topic}}"
    - id: merge
      type: transform
      dependsOn: [gather-a, gather-b]
      template: |
        - {{nodes.gather-a.output}}
        - {{nodes.gather-b.output}}
  outputs:
    summary:
      from: nodes.merge.output
`;

describe('Phase I — Workflows, Channels, Runtimes, Voice', () => {
  it('DAG executor runs parallel dependsOn workflow', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-i-wf-'));
    await Workspace.init(tmp);
    await fs.mkdir(path.join(tmp, 'workflows'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'workflows/example-dag.yaml'), EXAMPLE_DAG, 'utf-8');

    const registry = createWorkflowRegistry(tmp);
    const executor = new DagExecutor({ registry });
    const result = await executor.run('example-dag', { topic: 'testing' });

    expect(result.status).toBe('completed');
    expect(result.outputs.summary).toContain('Finding A');
    expect(result.outputs.summary).toContain('Finding B');
    expect(result.nodes.length).toBe(3);
  });

  it('Teams and Matrix adapters support approval outbound', async () => {
    const stored: StoredSession = {
      id: 's1',
      userId: 'u1',
      agentName: 'architect',
      channel: 'teams',
      messages: [],
      status: 'idle',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      metadata: {},
    };
    const sessions: SessionStore = {
      get: async () => stored,
      create: async (s) => ({ ...s, id: 's1', createdAt: stored.createdAt, lastActiveAt: stored.lastActiveAt }),
      getByChannelThread: async () => null,
      update: async () => stored,
      list: async () => [stored],
      listActive: async () => [stored],
    };
    const bridge = new ChannelSessionBridge(sessions, { defaultAgent: 'architect', defaultUserId: 'u1' });
    const opts = { sessionBridge: bridge, sessions, onApproval: async () => {} };

    const teams = new TeamsChannel(opts);
    const matrix = new MatrixChannel(opts);

    await teams.sendApprovalRequest('s1', {
      sessionId: 's1',
      requestId: 'req-1',
      toolName: 'deploy',
      reason: 'Deploy to staging',
      actions: ['approve', 'reject'],
    });
    await matrix.sendApprovalRequest('s1', {
      sessionId: 's1',
      requestId: 'req-2',
      toolName: 'deploy',
      reason: 'Deploy to staging',
      actions: ['approve', 'reject'],
    });

    expect(teams.store.approvals.get('s1')).toHaveLength(1);
    expect(matrix.store.approvals.get('s1')).toHaveLength(1);
  });

  it('SSH runtime mock test executes echo', async () => {
    process.env.ANVIO_SSH_MOCK = '1';
    const ssh = new SshRuntimeProvider();
    expect(ssh.isConfigured()).toBe(true);
    const probe = await ssh.testConnection();
    expect(probe.ok).toBe(true);
    expect(probe.output).toBe('remote-ok');
    delete process.env.ANVIO_SSH_MOCK;
  });

  it('voice pipeline stub speak and transcribe without API key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const pipeline = new VoicePipeline();
    const spoken = await pipeline.speak('Hello Anvio');
    expect(spoken.mimeType).toBe('text/plain');
    const transcript = await pipeline.transcribe('/dev/null');
    expect(transcript).toContain('voice-stub');
    if (prev) process.env.OPENAI_API_KEY = prev;
  });
});
