import { describe, expect, it, vi } from 'vitest';
import { ChannelSessionBridge, EmailChannel, MatrixChannel, TeamsChannel } from '@anvio/channels';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('Phase P8 — Teams/Matrix/Email channel E2E', () => {
  it('Teams inbound stores conversation metadata and outbound uses Bot Framework', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p8-teams-'));
    await Workspace.init(tmpDir);
    const storage = new FilesystemStorageProvider(tmpDir);
    const sessions = (await Workspace.open(tmpDir)).sessions;
    const bridge = new ChannelSessionBridge(sessions, {
      defaultAgent: 'architect',
      defaultUserId: 'u1',
    });

    const inbound: string[] = [];
    const teams = new TeamsChannel({
      sessionBridge: bridge,
      sessions,
      appId: 'app-id',
      appPassword: 'secret',
      serviceUrl: 'https://smba.test.example',
    });
    teams.onMessage(async (msg) => {
      inbound.push(msg.content);
    });

    const handled = await teams.handleActivity({
      type: 'message',
      text: 'Hello Teams',
      serviceUrl: 'https://smba.test.example',
      from: { id: 'user-1' },
      conversation: { id: 'conv-1' },
    });

    expect(handled?.sessionId).toBeTruthy();
    expect(inbound).toEqual(['Hello Teams']);

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'token-abc' }), { status: 200 });
      }
      if (url.includes('/activities')) {
        expect(init?.method).toBe('POST');
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await teams.sendMessage(handled!.sessionId, {
      sessionId: handled!.sessionId,
      type: 'done',
      content: 'Reply from agent',
    });

    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Matrix inbound/outbound round-trip via room webhook shape', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p8-matrix-'));
    await Workspace.init(tmpDir);
    const storage = new FilesystemStorageProvider(tmpDir);
    const sessions = (await Workspace.open(tmpDir)).sessions;
    const bridge = new ChannelSessionBridge(sessions, {
      defaultAgent: 'architect',
      defaultUserId: 'u1',
    });

    const matrix = new MatrixChannel({
      sessionBridge: bridge,
      sessions,
      homeserverUrl: 'https://matrix.test.example',
      accessToken: 'syt_token',
      roomId: '!room:example.org',
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: '$1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const handled = await matrix.handleRoomMessage({
      roomId: '!room:example.org',
      senderId: '@alice:example.org',
      body: 'ping matrix',
    });

    expect(handled?.userId).toBe('matrix:@alice:example.org');

    await matrix.sendMessage(handled!.sessionId, {
      sessionId: handled!.sessionId,
      type: 'done',
      content: 'pong',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/send/m.room.message'),
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('Email inbound queues outbound reply metadata', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p8-email-'));
    await Workspace.init(tmpDir);
    const sessions = (await Workspace.open(tmpDir)).sessions;
    const bridge = new ChannelSessionBridge(sessions, {
      defaultAgent: 'architect',
      defaultUserId: 'u1',
    });

    const email = new EmailChannel({
      sessionBridge: bridge,
      sessions,
      smtpHost: 'smtp.test.example',
      username: 'bot@test.example',
    });

    const handled = await email.handleInboundEmail({
      from: 'user@test.example',
      subject: 'Deploy question',
      body: 'Can we ship today?',
    });

    await email.sendMessage(handled.sessionId, {
      sessionId: handled.sessionId,
      type: 'done',
      content: 'Yes, after approval.',
    });

    expect(email.outboundQueue).toHaveLength(1);
    expect(email.outboundQueue[0]).toMatchObject({
      to: 'user@test.example',
      subject: 'Re: Deploy question',
      body: 'Yes, after approval.',
    });

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
