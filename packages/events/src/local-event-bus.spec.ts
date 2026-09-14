import { describe, expect, it, vi } from 'vitest';
import { LocalEventBus } from './local-event-bus.js';
import { EventSubjects } from './types.js';

describe('LocalEventBus handler isolation (issue #71)', () => {
  it('runs every handler even when one throws', async () => {
    const bus = new LocalEventBus('/test');
    const seen: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await bus.subscribeCore(EventSubjects.AGENT_RUN_CHUNK, async () => {
      seen.push('first');
    });
    await bus.subscribeCore(EventSubjects.AGENT_RUN_CHUNK, async () => {
      throw new Error("can't parse entities");
    });
    await bus.subscribeCore(EventSubjects.AGENT_RUN_CHUNK, async () => {
      seen.push('third');
    });

    await bus.publishCore(EventSubjects.AGENT_RUN_CHUNK, 'test.chunk', { delta: 'hi' });

    expect(seen).toEqual(['first', 'third']);
    vi.restoreAllMocks();
  });

  it('does not reject the publish that started the run', async () => {
    const bus = new LocalEventBus('/test');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await bus.subscribeCore(EventSubjects.AGENT_RUN_REQUESTED, async () => {
      throw new Error('Telegram API error: sendMessage');
    });

    await expect(
      bus.publishCore(EventSubjects.AGENT_RUN_REQUESTED, 'test.requested', {}),
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
  });

  it('logs the failure rather than swallowing it silently', async () => {
    const bus = new LocalEventBus('/test');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await bus.subscribeCore(EventSubjects.AGENT_RUN_CHUNK, async () => {
      throw new Error('boom');
    });
    await bus.publishCore(EventSubjects.AGENT_RUN_CHUNK, 'test.chunk', {});

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(EventSubjects.AGENT_RUN_CHUNK);

    vi.restoreAllMocks();
  });
});
