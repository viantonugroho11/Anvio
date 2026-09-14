import { describe, expect, it, vi } from 'vitest';
import { ChannelHub } from '@anvio/channels';
import { parseHarnessConfig, type ApprovalRequestMessage, type ChannelAdapter } from '@anvio/core';
import { createHarnessGateway } from '@anvio/harness';
import { Workspace } from '@anvio/workspace';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const SOUL = `## Identity
- Name: Gated Agent

## Approvers
- telegram:1001: anything ; catchall

## Mandate
- Nothing mutating without a human.
`;

const DEFAULTS = `apiVersion: anvio.io/v1
kind: HarnessDefaults
metadata: { name: default }
spec:
  enabled: true
  suppressRawOutput: true
  idleMinutes: 15
  resumeSessions: true
  connectBroker: { enabled: false }`;

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-runtime-approval-'));
  await Workspace.init(tmp);
  const ws = await Workspace.open(tmp);

  const requests: ApprovalRequestMessage[] = [];
  const hub = new ChannelHub();
  hub.register({
    channelType: 'telegram',
    sendMessage: async () => {},
    sendApprovalRequest: async (_sessionId: string, request: ApprovalRequestMessage) => {
      requests.push(request);
    },
    onMessage: () => {},
    start: async () => {},
    stop: async () => {},
  } as unknown as ChannelAdapter);

  const harness = createHarnessGateway({
    defaults: parseHarnessConfig(parseYaml(DEFAULTS)).spec,
    profiles: [],
    policy: (await import('@anvio/soul-gate')).parseSoulMd(SOUL),
    channelHub: hub,
    sessions: ws.sessions,
  });

  const session = await ws.sessions.create({
    userId: 'telegram:1001',
    agentName: 'architect',
    channel: 'telegram',
    messages: [],
    status: 'calling_model',
  });

  return { ws, harness, session, requests };
}

describe('runtime-originated approvals', () => {
  it('renders a runtime approval with actions and resolves on the same id (issue #68)', async () => {
    const { harness, session, requests } = await setup();

    await harness.registerRuntimeApproval(session.id, 'telegram', {
      requestId: 'runtime-req-1',
      toolName: 'anvio_tools__shell',
      reason: 'delete the staging bucket',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requestId: 'runtime-req-1',
      toolName: 'anvio_tools__shell',
      reason: 'delete the staging bucket',
      actions: ['approve', 'reject'],
    });

    // The id on the buttons is the one the gate knows — before the fix the
    // gate had never seen it and the callback silently no-opped.
    await expect(
      harness.resolveApproval(session.id, 'runtime-req-1', 'telegram:1001', true),
    ).resolves.toEqual({ status: 'resolved' });
  });

  it('blocks requestApprovalAndWait until a human decides (issue #69)', async () => {
    const { ws, harness, session, requests } = await setup();

    const pending = harness.requestApprovalAndWait(
      session.id,
      'telegram',
      'Run Bash: rm -rf /tmp/x',
      'Bash',
      { command: 'rm -rf /tmp/x' },
    );

    await vi.waitFor(() => expect(requests).toHaveLength(1));

    const awaiting = await ws.sessions.get(session.id);
    expect(awaiting?.status).toBe('awaiting_approval');
    expect(awaiting?.pendingApproval?.toolName).toBe('Bash');
    // Marks the turn as still alive so the APPROVAL_DECIDED consumer does
    // not re-dispatch the run on top of it.
    expect(awaiting?.metadata?.inlineApprovalRequestId).toBe(requests[0]!.requestId);

    await harness.resolveApproval(session.id, requests[0]!.requestId, 'telegram:1001', true);

    await expect(pending).resolves.toBe(true);

    const after = await ws.sessions.get(session.id);
    expect(after?.pendingApproval).toBeUndefined();
    expect(after?.metadata?.inlineApprovalRequestId).toBeUndefined();
  });

  it('denies requestApprovalAndWait when the approver rejects', async () => {
    const { harness, session, requests } = await setup();

    const pending = harness.requestApprovalAndWait(session.id, 'telegram', 'drop prod', 'Bash');
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await harness.resolveApproval(session.id, requests[0]!.requestId, 'telegram:1001', false);

    await expect(pending).resolves.toBe(false);
  });
});
