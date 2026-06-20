import { describe, expect, it } from 'vitest';
import { parseRawEmail } from '@anvio/channels';
import { SshRuntimeProvider, DaytonaRuntimeProvider } from '@anvio/runtimes';
import { createStreamingSttSession, streamTranscribe } from '@anvio/voice';

describe('Phase P13 — remote exec, streaming STT, email threads', () => {
  it('parses email threading headers', () => {
    const raw = [
      'From: alice@example.com',
      'Subject: Re: Project',
      'Message-ID: <msg-1@example.com>',
      'In-Reply-To: <root@example.com>',
      'References: <root@example.com> <mid@example.com>',
      '',
      'Body text',
    ].join('\r\n');

    const parsed = parseRawEmail(raw);
    expect(parsed.messageId).toBe('<msg-1@example.com>');
    expect(parsed.inReplyTo).toBe('<root@example.com>');
    expect(parsed.references).toEqual(['<root@example.com>', '<mid@example.com>']);
  });

  it('SSH execRemote works in mock mode', async () => {
    process.env.ANVIO_SSH_MOCK = '1';
    const ssh = new SshRuntimeProvider();
    const result = await ssh.execRemote('echo p13-ok');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('p13-ok');
    delete process.env.ANVIO_SSH_MOCK;
  });

  it('Daytona execRemote works in mock mode', async () => {
    process.env.ANVIO_DAYTONA_MOCK = '1';
    const daytona = new DaytonaRuntimeProvider({});
    const result = await daytona.execRemote('echo daytona-ok');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('daytona-ok');
    delete process.env.ANVIO_DAYTONA_MOCK;
  });

  it('streaming STT yields final transcript', async () => {
    const session = createStreamingSttSession();
    async function* chunks() {
      yield Buffer.from('audio-chunk');
    }
    const parts: string[] = [];
    for await (const part of streamTranscribe(session, chunks())) {
      parts.push(part.text);
      if (part.final) break;
    }
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.at(-1)).toContain('transcribed');
  });
});
