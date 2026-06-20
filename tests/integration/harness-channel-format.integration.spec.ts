import { describe, expect, it } from 'vitest';
import { formatForChannel } from '@anvio/harness';

describe('Harness channel format snapshots', () => {
  const sample = '**Hello** `code` [link](https://example.com)';

  it('snapshots slack mrkdwn formatting', () => {
    expect(formatForChannel('slack', sample)).toMatchSnapshot();
  });

  it('snapshots telegram HTML formatting', () => {
    expect(formatForChannel('telegram', sample)).toMatchSnapshot();
  });

  it('snapshots discord plain formatting', () => {
    expect(formatForChannel('discord', sample)).toMatchSnapshot();
  });

  it('snapshots teams plain formatting', () => {
    expect(formatForChannel('teams', sample)).toMatchSnapshot();
  });

  it('snapshots matrix plain formatting', () => {
    expect(formatForChannel('matrix', sample)).toMatchSnapshot();
  });
});
