import { describe, expect, it } from 'vitest';
import type { ChatMessage, RuntimeRequest } from '@anvio/core';
import {
  buildPromptWithHistory,
  buildResumeAwarePrompt,
  readVendorSessionId,
} from './session-history.js';

function request(
  messages: ChatMessage[] = [],
  metadata?: Record<string, unknown>,
  content = 'latest question',
): RuntimeRequest {
  return {
    session: {
      id: 'sess-1',
      userId: 'user-1',
      agentId: 'tech-lead',
      channel: 'telegram',
      state: { status: 'idle', messages, metadata },
      lastActiveAt: new Date(),
    },
    agent: {} as RuntimeRequest['agent'],
    input: { content },
  };
}

describe('buildPromptWithHistory', () => {
  it('returns the raw input when there is no history', () => {
    expect(buildPromptWithHistory(request())).toBe('latest question');
  });

  it('replays prior turns ahead of the current input', () => {
    const prompt = buildPromptWithHistory(
      request([
        { role: 'user', content: 'my name is Vianto' },
        { role: 'assistant', content: 'noted' },
      ]),
    );

    expect(prompt).toContain('<conversation_history>');
    expect(prompt).toContain('my name is Vianto');
    expect(prompt).toContain('<assistant>\nnoted\n</assistant>');
    expect(prompt.endsWith('latest question')).toBe(true);
  });

  it('drops the oldest turns first when over budget', () => {
    const prompt = buildPromptWithHistory(
      request([
        { role: 'user', content: 'OLDEST'.padEnd(200, 'x') },
        { role: 'user', content: 'NEWEST' },
      ]),
      { maxChars: 60 },
    );

    expect(prompt).toContain('NEWEST');
    expect(prompt).not.toContain('OLDEST');
    expect(prompt).toContain('earlier turns omitted');
  });

  it('falls back to the raw input when even one turn will not fit', () => {
    const prompt = buildPromptWithHistory(request([{ role: 'user', content: 'x'.repeat(500) }]), {
      maxChars: 10,
    });
    expect(prompt).toBe('latest question');
  });
});

describe('readVendorSessionId', () => {
  it('reads the handle stored for that runtime', () => {
    const req = request([], { vendorSessions: { 'claude-code': 'sdk-abc' } });
    expect(readVendorSessionId(req, 'claude-code')).toBe('sdk-abc');
  });

  it('does not leak one vendor handle to another runtime', () => {
    const req = request([], { vendorSessions: { 'claude-code': 'sdk-abc' } });
    expect(readVendorSessionId(req, 'codex')).toBeUndefined();
  });

  it('ignores empty or malformed metadata', () => {
    expect(readVendorSessionId(request(), 'claude-code')).toBeUndefined();
    expect(readVendorSessionId(request([], { vendorSessions: 'nope' }), 'claude-code')).toBeUndefined();
    expect(
      readVendorSessionId(request([], { vendorSessions: { 'claude-code': '  ' } }), 'claude-code'),
    ).toBeUndefined();
  });
});

describe('buildResumeAwarePrompt', () => {
  const history: ChatMessage[] = [{ role: 'user', content: 'earlier turn' }];

  it('sends only the new input when the vendor already holds the transcript', () => {
    expect(buildResumeAwarePrompt(request(history), 'sdk-abc')).toBe('latest question');
  });

  it('replays history on a cold start', () => {
    expect(buildResumeAwarePrompt(request(history), undefined)).toContain('earlier turn');
  });
});
