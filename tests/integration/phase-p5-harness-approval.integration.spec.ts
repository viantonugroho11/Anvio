import { describe, expect, it } from 'vitest';
import { ChannelHub } from '@anvio/channels';
import { parseHarnessConfig } from '@anvio/core';
import {
  createHarnessGateway,
  createHarnessAwareToolPort,
} from '@anvio/harness';
import { ToolGateway } from '@anvio/tools';
import { Workspace } from '@anvio/workspace';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const POLICY_SOUL = `## Identity
- Name: Multi-channel Agent

## Reporting
- Manager: telegram:1001

## Approvers
- telegram:1001: anything ; catchall
- whatsapp:15551234567: database migration, schema

## Mandate
- Ship safely with human approval on mutating ops.
`;

describe('Phase P5 — multi-channel harness approval', () => {
  it('request_approval returns pending_approval on any channel', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p5-'));
    await Workspace.init(tmp);
    await fs.mkdir(path.join(tmp, 'souls', 'architect-soul'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'souls', 'architect-soul', 'SOUL.md'), POLICY_SOUL);

    const hub = new ChannelHub();
    const ws = await Workspace.open(tmp);
    const harness = createHarnessGateway({
      defaults: parseHarnessConfig(
        parseYaml(`apiVersion: anvio.io/v1
kind: HarnessDefaults
metadata: { name: default }
spec:
  enabled: true
  soulSlug: architect-soul
  suppressRawOutput: true
  idleMinutes: 15
  resumeSessions: true
  connectBroker: { enabled: false }`),
      ).spec,
      profiles: [],
      policy: (await import('@anvio/soul-gate')).parseSoulMd(POLICY_SOUL, 'architect-soul'),
      channelHub: hub,
      sessions: ws.sessions,
    });

    const stored = await ws.sessions.create({
      userId: 'telegram:1001',
      agentName: 'architect',
      channel: 'telegram',
      messages: [],
      status: 'calling_model',
    });

    const gateway = await ToolGateway.load(tmp);
    const port = createHarnessAwareToolPort(gateway, harness);

    expect(port.listTools()).toContain('anvio_channel__request_approval');

    const result = await port.call(
      {
        name: 'anvio_channel__request_approval',
        arguments: { summary: 'run database migration on production' },
      },
      {
        sessionId: stored.id,
        agentId: 'architect',
        userId: 'telegram:1001',
        channel: 'telegram',
      },
    );

    expect(result.status).toBe('pending_approval');
    expect(result.approvalRequestId).toBeTruthy();

    const updated = await ws.sessions.get(stored.id);
    expect(updated?.status).toBe('awaiting_approval');
    expect(updated?.pendingApproval?.reason).toContain('database migration');
  });

  it('resolveApproval accepts matching approver on whatsapp channel', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p5-wa-'));
    const hub = new ChannelHub();
    const ws = await Workspace.open(tmp);
    const policy = (await import('@anvio/soul-gate')).parseSoulMd(POLICY_SOUL);
    const harness = createHarnessGateway({
      defaults: parseHarnessConfig(
        parseYaml(`apiVersion: anvio.io/v1
kind: HarnessDefaults
metadata: { name: default }
spec:
  enabled: true
  suppressRawOutput: true
  idleMinutes: 15
  resumeSessions: true
  connectBroker: { enabled: false }`),
      ).spec,
      profiles: [],
      policy,
      channelHub: hub,
      sessions: ws.sessions,
    });

    const stored = await ws.sessions.create({
      userId: 'whatsapp:15551234567',
      agentName: 'architect',
      channel: 'whatsapp',
      messages: [],
      status: 'idle',
    });

    const requestId = await harness.createOutputPort(stored.id, 'whatsapp').requestApproval(
      stored.id,
      'apply database migration to staging',
    );

    const ok = await harness.resolveApproval(
      stored.id,
      requestId,
      'whatsapp:15551234567',
      true,
    );
    expect(ok).toBe(true);
  });
});
