import { describe, expect, it, vi } from 'vitest';
import type { MemoryProvider, SoulDefinition } from '@anvio/core';
import { LearningEngine } from './index.js';

const soul = (allowAutoUpdate: boolean) => ({ spec: { evolution: { allowAutoUpdate } } }) as unknown as SoulDefinition;

describe('LearningEngine.consolidateEpisodic', () => {
  it('consolidates sessions and honors the soul evolution gate', async () => {
    const consolidateSession = vi.fn(async (_id: string, summarize: (m: never[]) => Promise<string>) =>
      summarize([{ role: 'user', content: 'ship it' }] as never[]),
    );
    const memory = { consolidateSession } as unknown as MemoryProvider;
    const engine = new LearningEngine(memory, '/ws');

    const result = await engine.consolidateEpisodic([
      { sessionId: 'a' },
      { sessionId: 'b', soul: soul(false) },
      { sessionId: 'c', soul: soul(true) },
    ]);

    expect(result).toEqual({ consolidated: 2, skipped: 1 });
    expect(consolidateSession.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
  });

  it('is a no-op for providers without episodic timelines', async () => {
    const engine = new LearningEngine({} as MemoryProvider, '/ws');
    expect(await engine.consolidateEpisodic([{ sessionId: 'a' }])).toEqual({ consolidated: 0, skipped: 1 });
  });
});
