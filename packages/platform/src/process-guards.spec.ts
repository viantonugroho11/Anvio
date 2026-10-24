import { describe, expect, it, vi } from 'vitest';
import { runShutdownSteps } from './process-guards.js';

describe('runShutdownSteps', () => {
  it('runs steps in order and keeps going after a failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    const result = await runShutdownSteps('test', [
      { name: 'a', run: () => void order.push('a') },
      {
        name: 'b',
        run: () => {
          order.push('b');
          throw new Error('b broke');
        },
      },
      { name: 'c', run: async () => void order.push('c') },
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ timedOut: false, failed: ['b'] });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('gives up after the timeout instead of hanging', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const started = Date.now();
    const result = await runShutdownSteps(
      'test',
      [{ name: 'hang', run: () => new Promise(() => {}) }],
      50,
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    errors.mockRestore();
  });
});
