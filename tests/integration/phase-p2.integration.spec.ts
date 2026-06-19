import { describe, expect, it } from 'vitest';
import { MattermostChannel } from '@anvio/channels';
import { VoicePipeline, isChannelVoiceEnabled, voiceInboundContent } from '@anvio/voice';
import { ChannelHub } from '@anvio/channels';
import { ChannelSessionBridge } from '@anvio/channels';
import { Workspace } from '@anvio/workspace';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

describe('Phase P2 — Voice & Mattermost (no desktop)', () => {
  it('voiceInboundContent prefixes transcript', () => {
    expect(voiceInboundContent('hello world')).toBe('[voice] hello world');
    expect(voiceInboundContent('')).toBe('[voice] (empty transcript)');
  });

  it('isChannelVoiceEnabled requires pipeline and flag', () => {
    const pipeline = new VoicePipeline();
    expect(isChannelVoiceEnabled({ voice: { enabled: true }, pipeline })).toBe(true);
    expect(isChannelVoiceEnabled({ voice: { enabled: false }, pipeline })).toBe(false);
    expect(isChannelVoiceEnabled({ voice: { enabled: true } })).toBe(false);
  });

  it('VoicePipeline transcribeBuffer works in stub mode without API key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const pipeline = new VoicePipeline();
    const text = await pipeline.transcribeBuffer(Buffer.from('fake-audio'), 'audio/ogg');
    expect(text).toContain('voice-stub');
    if (prev) process.env.OPENAI_API_KEY = prev;
  });

  it('MattermostChannel registers with channel hub', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-mm-'));
    const workspace = await Workspace.open(tmp);
    const bridge = new ChannelSessionBridge(workspace.sessions, {
      defaultAgent: 'architect',
      defaultUserId: 'local-user',
    });
    const channel = new MattermostChannel({
      serverUrl: 'https://mattermost.example.com',
      botToken: 'test-token',
      sessionBridge: bridge,
      sessions: workspace.sessions,
    });
    expect(channel.channelType).toBe('mattermost');
    const hub = new ChannelHub();
    hub.register(channel);
    expect(hub.getAdapter('mattermost')).toBeDefined();
  });
});
