import { describe, it, expect } from 'vitest';
import { PendingMutationStore } from './pending-mutations.js';

describe('PendingMutationStore', () => {
  it('mints a fresh token on each put and takes it once', () => {
    const store = new PendingMutationStore();
    const a = store.put({
      action: 'new',
      primitive: 'agent',
      slug: 'x',
      actor: 'me',
      channel: 'cli',
      sessionId: 's1',
    });
    const b = store.put({
      action: 'rm',
      primitive: 'agent',
      slug: 'y',
      actor: 'me',
      channel: 'cli',
      sessionId: 's1',
    });
    expect(a.token).not.toBe(b.token);
    const taken = store.take(a.token);
    expect(taken?.slug).toBe('x');
    expect(store.take(a.token)).toBeNull();
    expect(store.take(b.token)?.slug).toBe('y');
  });

  it('expires entries after ttl', () => {
    let now = 1_000_000;
    const store = new PendingMutationStore({ ttlMs: 500, now: () => now });
    const e = store.put({
      action: 'edit',
      primitive: 'skill',
      slug: 's',
      body: 'x',
      actor: 'me',
      channel: 'cli',
      sessionId: 's1',
    });
    now += 600;
    expect(store.take(e.token)).toBeNull();
  });

  it('listForSession returns only that session\'s live entries', () => {
    const store = new PendingMutationStore();
    store.put({ action: 'new', primitive: 'agent', slug: 'a', actor: 'me', channel: 'cli', sessionId: 's1' });
    store.put({ action: 'new', primitive: 'agent', slug: 'b', actor: 'me', channel: 'cli', sessionId: 's2' });
    expect(store.listForSession('s1').map((e) => e.slug)).toEqual(['a']);
  });

  it('cancel removes without executing', () => {
    const store = new PendingMutationStore();
    const e = store.put({
      action: 'rm',
      primitive: 'agent',
      slug: 'x',
      actor: 'me',
      channel: 'cli',
      sessionId: 's1',
    });
    expect(store.cancel(e.token)).toBe(true);
    expect(store.take(e.token)).toBeNull();
  });
});
