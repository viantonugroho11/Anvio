import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue, Semaphore } from './concurrency.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('KeyedSerialQueue', () => {
  it('serializes tasks with the same key in submission order', async () => {
    const queue = new KeyedSerialQueue();
    const log: string[] = [];
    await Promise.all([
      queue.run('s1', async () => {
        log.push('a:start');
        await delay(20);
        log.push('a:end');
      }),
      queue.run('s1', async () => {
        log.push('b:start');
        log.push('b:end');
      }),
    ]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('runs different keys concurrently', async () => {
    const queue = new KeyedSerialQueue();
    const log: string[] = [];
    await Promise.all([
      queue.run('s1', async () => {
        await delay(20);
        log.push('s1');
      }),
      queue.run('s2', async () => {
        log.push('s2');
      }),
    ]);
    expect(log).toEqual(['s2', 's1']);
  });

  it('keeps going after a failed task and reports busy state', async () => {
    const queue = new KeyedSerialQueue();
    const failed = queue.run('s', async () => {
      throw new Error('boom');
    });
    expect(queue.isBusy('s')).toBe(true);
    await expect(failed).rejects.toThrow('boom');
    await expect(queue.run('s', async () => 'ok')).resolves.toBe('ok');
    await delay(0);
    expect(queue.isBusy('s')).toBe(false);
  });
});

describe('Semaphore', () => {
  it('never exceeds its limit', async () => {
    const semaphore = new Semaphore(2);
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        semaphore.use(async () => {
          peak = Math.max(peak, semaphore.inUse);
          await delay(5);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(semaphore.inUse).toBe(0);
  });

  it('releases on failure', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.use(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(semaphore.use(async () => 'next')).resolves.toBe('next');
  });
});
