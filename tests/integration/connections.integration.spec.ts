import { describe, expect, it } from 'vitest';
import { ConnectionBroker, ConnectionStore, startLoginHost } from '@anvio/harness';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const ENCRYPTION_KEY = 'test-connection-key-32chars-min!!';

describe('Phase P1 — Contextual Connections', () => {
  it('isolates connections per user without grant', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-conn-'));
    const store = new ConnectionStore(tmp, ENCRYPTION_KEY);
    const broker = new ConnectionBroker(store, true, 3600, tmp);

    await broker.putConnection({
      channel: 'slack',
      userId: 'user-a',
      service: 'github',
      payload: '{"token":"secret-a"}',
      threadId: 'thread-1',
    });

    const ownerPayload = await broker.getPayloadForAccess({
      requesterUserId: 'user-a',
      channel: 'slack',
      threadId: 'thread-1',
      service: 'github',
    });
    expect(ownerPayload).toContain('secret-a');

    const intruderPayload = await broker.getPayloadForAccess({
      requesterUserId: 'user-b',
      channel: 'slack',
      threadId: 'thread-1',
      service: 'github',
    });
    expect(intruderPayload).toBeNull();
  });

  it('allows borrowed access only for granted thread', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-conn-'));
    const store = new ConnectionStore(tmp, ENCRYPTION_KEY);
    const broker = new ConnectionBroker(store, true, 3600, tmp);

    await broker.putConnection({
      channel: 'slack',
      userId: 'user-a',
      service: 'jira',
      payload: '{"token":"jira-a"}',
      threadId: 'thread-granted',
    });

    await broker.grantAccess({
      ownerUserId: 'user-a',
      borrowerUserId: 'user-b',
      channel: 'slack',
      threadId: 'thread-granted',
      service: 'jira',
      grantedAt: new Date().toISOString(),
      scope: 'thread',
    });

    const allowed = await broker.getPayloadForAccess({
      requesterUserId: 'user-b',
      channel: 'slack',
      threadId: 'thread-granted',
      service: 'jira',
    });
    expect(allowed).toContain('jira-a');

    const wrongThread = await broker.getPayloadForAccess({
      requesterUserId: 'user-b',
      channel: 'slack',
      threadId: 'thread-other',
      service: 'jira',
    });
    expect(wrongThread).toBeNull();
  });

  it('login-host captures OAuth callback query params', async () => {
    const host = await startLoginHost({ port: 0, timeoutMs: 5000 });
    const wait = host.waitForCallback();
    await fetch(`${host.callbackUrl}?code=oauth-code-123&state=abc`);

    const query = await wait;
    expect(query.code).toBe('oauth-code-123');
    expect(query.state).toBe('abc');
    await host.close();
  });

  it('lists and revokes stored connections', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-conn-'));
    const store = new ConnectionStore(tmp, ENCRYPTION_KEY);
    const broker = new ConnectionBroker(store, true, 3600, tmp);

    await broker.putConnection({
      channel: 'cli',
      userId: 'local-user',
      service: 'notion',
      payload: '{"key":"n"}',
      threadId: 't1',
    });

    const listed = await broker.listConnections('local-user');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.service).toBe('notion');

    const revoked = await broker.revokeConnection('cli', 'local-user', 'notion');
    expect(revoked).toBe(true);
    expect(await broker.listConnections('local-user')).toHaveLength(0);
  });
});
