import { describe, expect, it } from 'vitest';
import { parseRawEmail, hasIdleCapability, parseCapabilities, isIdleWakeLine } from './imap-client.js';

describe('parseRawEmail', () => {
  it('extracts from, subject, and body from raw RFC822', () => {
    const raw = [
      'From: user@example.com',
      'Subject: Hello IMAP',
      '',
      'Body text here',
    ].join('\r\n');

    expect(parseRawEmail(raw)).toEqual({
      from: 'user@example.com',
      subject: 'Hello IMAP',
      body: 'Body text here',
    });
  });
});

describe('IMAP IDLE (RFC 2177) helpers', () => {
  it('parseCapabilities extracts tokens from the untagged CAPABILITY line', () => {
    const response = 'A1 OK\r\n* CAPABILITY IMAP4rev1 IDLE UIDPLUS\r\nA1 OK CAPABILITY completed\r\n';
    expect(parseCapabilities(response)).toEqual(['IMAP4rev1', 'IDLE', 'UIDPLUS']);
  });

  it('hasIdleCapability is true when the server advertises IDLE', () => {
    expect(hasIdleCapability('* CAPABILITY IMAP4rev1 IDLE\r\nA1 OK\r\n')).toBe(true);
  });

  it('hasIdleCapability is false when the server does not advertise IDLE', () => {
    expect(hasIdleCapability('* CAPABILITY IMAP4rev1 UIDPLUS\r\nA1 OK\r\n')).toBe(false);
  });

  it('isIdleWakeLine matches EXISTS/RECENT/EXPUNGE untagged lines', () => {
    expect(isIdleWakeLine('* 3 EXISTS')).toBe(true);
    expect(isIdleWakeLine('* 1 RECENT')).toBe(true);
    expect(isIdleWakeLine('* 2 EXPUNGE')).toBe(true);
    expect(isIdleWakeLine('* OK still here')).toBe(false);
    expect(isIdleWakeLine('')).toBe(false);
  });
});
