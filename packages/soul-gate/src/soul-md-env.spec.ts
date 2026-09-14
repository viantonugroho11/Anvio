import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseSoulMd } from './soul-md-parser.js';
import { extractIdsFromLine } from './verifier.js';

describe('SOUL.md env expansion (#80)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an unexpanded ${VAR} placeholder in a channel:id pattern', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ids = extractIdsFromLine('telegram:${TELEGRAM_OWNER_USER_ID}');
    const channelIds = ids.filter((id) => id.startsWith('telegram:'));
    expect(channelIds).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpanded placeholder'));
    warn.mockRestore();
  });

  it('accepts a resolved numeric id', () => {
    const ids = extractIdsFromLine('telegram:838714240');
    expect(ids).toContain('telegram:838714240');
  });

  it('parseSoulMd produces an approver from an expanded id', () => {
    const source = `## Approvers
- telegram:838714240: anything ; catchall
`;
    const policy = parseSoulMd(source);
    expect(policy.approvers).toHaveLength(1);
    expect(policy.approvers[0]!.userId).toBe('telegram:838714240');
  });
});
