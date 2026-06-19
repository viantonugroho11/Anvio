import { describe, it, expect } from 'vitest';
import { cronMatches, nextCronRuns, parseCronExpression } from './cron-parser.js';

describe('cron-parser', () => {
  it('parses standard 5-field cron expression', () => {
    const cron = parseCronExpression('0 8 * * *');
    expect(cron.minute.any).toBe(false);
    expect(cron.hour.values.has(8)).toBe(true);
  });

  it('matches daily schedule at 08:00', () => {
    const date = new Date('2026-06-19T08:00:00');
    expect(cronMatches('0 8 * * *', date)).toBe(true);
    expect(cronMatches('0 9 * * *', date)).toBe(false);
  });

  it('matches Monday schedule', () => {
    const monday = new Date('2026-06-22T09:00:00');
    expect(cronMatches('0 9 * * MON', monday)).toBe(true);
    const tuesday = new Date('2026-06-23T09:00:00');
    expect(cronMatches('0 9 * * MON', tuesday)).toBe(false);
  });

  it('rejects invalid cron expression', () => {
    expect(() => parseCronExpression('0 8 * *')).toThrow();
  });

  it('computes next cron runs', () => {
    const from = new Date('2026-06-19T07:00:00');
    const runs = nextCronRuns('0 8 * * *', from, 2);
    expect(runs.length).toBe(2);
    expect(runs[0].getHours()).toBe(8);
  });

  it('matches exact minute boundary', () => {
    expect(cronMatches('30 14 * * *', new Date('2026-01-01T14:30:00'))).toBe(true);
  });
});
