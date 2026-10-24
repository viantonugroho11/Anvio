const DOW: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export function parseCronExpression(expression: string): {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
} {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${expression}`);
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseDowField(parts[4]),
  };
}

type CronField = { any: boolean; values: Set<number> };

function parseField(token: string, min: number, max: number): CronField {
  if (token === '*') return { any: true, values: new Set() };

  const values = new Set<number>();
  for (const part of token.split(',')) {
    if (part.includes('/')) {
      const [base, stepStr] = part.split('/');
      const step = Number(stepStr);
      const start = base === '*' ? min : Number(base);
      for (let i = start; i <= max; i += step) values.add(i);
      continue;
    }
    if (part.includes('-')) {
      const [from, to] = part.split('-').map(Number);
      for (let i = from; i <= to; i++) values.add(i);
      continue;
    }
    const n = Number(part);
    if (Number.isNaN(n) || n < min || n > max) {
      throw new Error(`Invalid cron field value: ${token}`);
    }
    values.add(n);
  }

  return { any: false, values };
}

function parseDowField(token: string): CronField {
  if (token === '*') return { any: true, values: new Set() };

  const values = new Set<number>();
  for (const part of token.split(',')) {
    const upper = part.toUpperCase();
    if (DOW[upper] != null) {
      values.add(DOW[upper]);
      continue;
    }
    if (part.includes('-')) {
      const [fromRaw, toRaw] = part.split('-');
      const from = DOW[fromRaw.toUpperCase()] ?? Number(fromRaw);
      const to = DOW[toRaw.toUpperCase()] ?? Number(toRaw);
      for (let i = from; i <= to; i++) values.add(i);
      continue;
    }
    const n = Number(part);
    if (!Number.isNaN(n)) values.add(n);
  }

  return { any: values.size === 0, values };
}

function matchesField(field: CronField, value: number): boolean {
  if (field.any) return true;
  return field.values.has(value);
}

export interface CronDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
  year: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Calendar fields of `date` in `timeZone` (IANA name), or in the process's local
 * zone when omitted. Throws RangeError for an unknown zone.
 */
export function cronDateParts(date: Date, timeZone?: string): CronDateParts {
  if (!timeZone) {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
      year: date.getFullYear(),
    };
  }
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dayOfMonth: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: WEEKDAYS[parts.weekday ?? ''] ?? 0,
    year: Number(parts.year),
  };
}

/**
 * Whether `date` matches `expression`, evaluated in `timeZone` when given.
 * Automations declare `spec.trigger.timezone` (default UTC) and the docs promise
 * timezone-aware schedules, but the engine used to evaluate every schedule in
 * the server's local time.
 */
export function cronMatches(expression: string, date: Date, timeZone?: string): boolean {
  const cron = parseCronExpression(expression);
  const p = cronDateParts(date, timeZone);
  return (
    matchesField(cron.minute, p.minute) &&
    matchesField(cron.hour, p.hour) &&
    matchesField(cron.dayOfMonth, p.dayOfMonth) &&
    matchesField(cron.month, p.month) &&
    matchesField(cron.dayOfWeek, p.dayOfWeek)
  );
}

/** Minute-resolution key of `date` in `timeZone`, for "already ran this minute". */
export function cronMinuteKey(date: Date, timeZone?: string): string {
  const p = cronDateParts(date, timeZone);
  return `${p.year}-${p.month}-${p.dayOfMonth} ${p.hour}:${p.minute}`;
}

export function nextCronRuns(expression: string, from: Date, limit = 5, timeZone?: string): Date[] {
  const results: Date[] = [];
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  let guard = 0;
  while (results.length < limit && guard < 525600) {
    if (cronMatches(expression, cursor, timeZone)) results.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
    guard++;
  }

  return results;
}
