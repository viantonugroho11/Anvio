import { describe, expect, it } from 'vitest';
import { parseRawEmail } from './imap-client.js';

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
