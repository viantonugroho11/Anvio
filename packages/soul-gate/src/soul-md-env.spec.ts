import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseSoulMd, policyFromSoulDefinition, warnUnsetSoulEnv } from './soul-md-parser.js';
import { parseSoulDefinition } from '@anvio/core';
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

  it('warns about unset ${VAR} placeholders but not defaults or escapes (#101)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = warnUnsetSoulEnv(
      '- telegram:${OWNER_ID}: anything\n- slack:${SET_ID}\n- x:${OPT:-1}\n- $${LITERAL}',
      { SET_ID: 'U1' },
    );
    expect(missing).toEqual(['OWNER_ID']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('${OWNER_ID}'));
    warn.mockRestore();
  });

  it('expands ${VAR} in a YAML soul policy extension (#101)', () => {
    process.env.ANVIO_TEST_TG_OWNER = '838714240';
    try {
      const definition = parseSoulDefinition({
        apiVersion: 'anvio.io/v1',
        kind: 'Soul',
        metadata: { slug: 'yaml-soul', version: '1.0.0' },
        spec: {
          name: 'Y',
          identity: {},
          communicationStyle: { tone: 'plain', format: 'short' },
          extensions: {
            policy: {
              approvers: [
                { channel: '*', userId: 'telegram:${ANVIO_TEST_TG_OWNER}', scope: 'anything', catchall: true },
              ],
            },
          },
        },
      });
      const policy = policyFromSoulDefinition(definition);
      expect(policy.approvers[0]!.userId).toBe('telegram:838714240');
    } finally {
      delete process.env.ANVIO_TEST_TG_OWNER;
    }
  });
});
