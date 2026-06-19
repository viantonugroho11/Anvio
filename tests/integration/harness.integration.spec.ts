import { describe, expect, it } from 'vitest';
import { ChannelHub } from '@anvio/channels';
import { parseHarnessConfig, parseSoulPolicy } from '@anvio/core';
import {
  createHarnessGateway,
  formatForChannel,
  isAuthorizedApprover,
  runSimulationScenario,
} from '@anvio/harness';
import { parseSoulMd, verifyPolicyIds } from '@anvio/soul-gate';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const SOUL_MD = `## Identity
- Name: Architect Soul
- Role: Senior Software Architect

## Reporting
- Manager: U_MANAGER01

## Mandate
- Help the team ship maintainable systems.

## Approvers
- <@U_MANAGER01>: anything ; catchall
- <@U_DBA01>: database migrations, schema, SQL

## Blocked
- <@U_SPAM01>
`;

describe('Phase G — Channel Harness', () => {
  it('parses SOUL.md and verifies policy ids', () => {
    const policy = verifyPolicyIds(SOUL_MD, parseSoulMd(SOUL_MD, 'architect-soul'));
    expect(policy.identity.name).toBe('Architect Soul');
    expect(policy.manager?.userId).toBe('U_MANAGER01');
    expect(policy.blockedUsers.some((u) => u.userId === 'U_SPAM01')).toBe(true);
    expect(policy.approvers.some((a) => a.userId === 'U_DBA01')).toBe(true);
  });

  it('rejects hallucinated user ids not in source', () => {
    const policy = parseSoulPolicy({
      blockedUsers: [{ channel: '*', userId: 'U_FAKE999' }],
    });
    const verified = verifyPolicyIds(SOUL_MD, policy);
    expect(verified.blockedUsers).toHaveLength(0);
  });

  it('drops blocked users and allows manager with mention engagement', async () => {
    const tmp = await fsMkdtemp();
    const storage = new FilesystemStorageProvider(tmp);
    const workspace = await Workspace.init(tmp);
    void workspace;
    void storage;

    const hub = new ChannelHub();
    const policy = parseSoulMd(SOUL_MD, 'architect-soul');
    policy.allowedZones = [{ channel: '*', ids: ['C_TEAM'] }];
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
      profiles: [
        {
          name: 'slack-like',
          channels: ['slack'],
          engageOn: 'mention',
          disengageOn: 'mention_other',
          dmPolicy: 'manager_only',
        },
      ],
      policy: policy,
      channelHub: hub,
      sessions: (await Workspace.open(tmp)).sessions,
    });

    const results = await runSimulationScenario(harness, [
      {
        channel: 'slack',
        threadId: 'thread-1',
        userId: 'U_SPAM01',
        content: 'hi',
        zoneId: 'C_TEAM',
        mentionedBot: true,
      },
      {
        channel: 'slack',
        threadId: 'thread-2',
        userId: 'U_MANAGER01',
        content: 'review this',
        zoneId: 'C_TEAM',
        mentionedBot: true,
      },
      {
        channel: 'slack',
        threadId: 'thread-3',
        userId: 'U_RANDOM',
        content: 'hello',
        zoneId: 'C_TEAM',
      },
    ]);

    expect(results[0]?.result.decision).toBe('drop');
    expect(results[1]?.result.decision).toBe('allow');
    expect(results[2]?.result.decision).toBe('disengage');
  });

  it('matches approver scope by keyword overlap', () => {
    const approvers = parseSoulMd(SOUL_MD).approvers;
    expect(isAuthorizedApprover(approvers, 'slack', 'run database migration on prod', 'U_DBA01')).toBe(
      true,
    );
    expect(isAuthorizedApprover(approvers, 'slack', 'update landing page copy', 'U_DBA01')).toBe(
      false,
    );
    expect(isAuthorizedApprover(approvers, 'slack', 'anything', 'U_MANAGER01')).toBe(true);
  });

  it('formats markdown per channel', () => {
    const md = '**bold** and `code`';
    expect(formatForChannel('slack', md)).toContain('*bold*');
    expect(formatForChannel('telegram', md)).toContain('<b>bold</b>');
    expect(formatForChannel('cli', md)).toContain('bold');
  });

  it('suppresses raw output for external channels when enabled', () => {
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
      policy: parseSoulMd(SOUL_MD),
      channelHub: new ChannelHub(),
      sessions: { create: async () => ({}) } as never,
    });
    expect(harness.shouldSuppressRawOutput('slack')).toBe(true);
    expect(harness.shouldSuppressRawOutput('cli')).toBe(false);
  });
});

async function fsMkdtemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'anvio-harness-'));
}
