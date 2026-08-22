import { describe, expect, it } from 'vitest';
import { WhatsAppChannel } from './whatsapp.js';

/**
 * The GET handshake had no coverage at all, which is how `'anvio-verify'` — a
 * default secret published in this repository — survived as the fallback for
 * `WHATSAPP_VERIFY_TOKEN` (issue #39).
 */

function channelWith(verifyToken: string): WhatsAppChannel {
  return new WhatsAppChannel({
    accessToken: 'access-token',
    phoneNumberId: '1234567890',
    verifyToken,
    sessionBridge: {} as never,
    sessions: {} as never,
  });
}

function handshake(token: string | undefined, challenge = 'challenge-abc') {
  return {
    'hub.mode': 'subscribe',
    'hub.verify_token': token,
    'hub.challenge': challenge,
  };
}

describe('WhatsApp webhook handshake', () => {
  it('returns the challenge for the configured token', () => {
    expect(channelWith('operator-secret').verifyWebhook(handshake('operator-secret'))).toBe(
      'challenge-abc',
    );
  });

  it('rejects a wrong token', () => {
    expect(channelWith('operator-secret').verifyWebhook(handshake('guess'))).toBeNull();
  });

  it('rejects a token that only shares a prefix', () => {
    expect(channelWith('operator-secret').verifyWebhook(handshake('operator'))).toBeNull();
  });

  it('rejects everything when no token is configured', () => {
    // The trap in removing the old default: a plain `===` against an empty
    // configured token matches an empty presented token, so dropping
    // `'anvio-verify'` without this guard swaps a known-secret hole for a
    // no-secret one.
    const channel = channelWith('');

    expect(channel.verifyWebhook(handshake(''))).toBeNull();
    expect(channel.verifyWebhook(handshake(undefined))).toBeNull();
    expect(channel.verifyWebhook(handshake('anvio-verify'))).toBeNull();
  });

  it('no longer honours the published default', () => {
    // Regression pin. Anyone who had read create-channels.ts could complete the
    // handshake of any deployment that never set the variable.
    expect(channelWith('').verifyWebhook(handshake('anvio-verify'))).toBeNull();
    expect(channelWith('operator-secret').verifyWebhook(handshake('anvio-verify'))).toBeNull();
  });

  it('requires mode=subscribe and a challenge', () => {
    const channel = channelWith('operator-secret');

    expect(
      channel.verifyWebhook({ ...handshake('operator-secret'), 'hub.mode': 'unsubscribe' }),
    ).toBeNull();
    expect(channel.verifyWebhook(handshake('operator-secret', ''))).toBeNull();
  });
});
