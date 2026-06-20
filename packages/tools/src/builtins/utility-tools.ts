export function jsonParse(text: string): { valid: true; value: unknown } | { valid: false; error: string } {
  try {
    return { valid: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function datetimeNow(timezone?: string): { iso: string; timezone: string; unixMs: number; local: string } {
  const now = new Date();
  const tz = timezone ?? 'UTC';
  let local: string;
  try {
    local = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    local = now.toISOString();
  }
  return { iso: now.toISOString(), timezone: tz, unixMs: now.getTime(), local };
}
