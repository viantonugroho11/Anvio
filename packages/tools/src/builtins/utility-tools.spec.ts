import { describe, expect, it } from 'vitest';
import { jsonParse, datetimeNow } from './utility-tools.js';

describe('utility builtins', () => {
  it('jsonParse parses valid JSON', () => {
    const result = jsonParse('{"a":1}');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual({ a: 1 });
  });

  it('jsonParse returns error for invalid JSON', () => {
    const result = jsonParse('{bad');
    expect(result.valid).toBe(false);
  });

  it('datetimeNow returns iso and unixMs', () => {
    const result = datetimeNow('UTC');
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.unixMs).toBeGreaterThan(0);
  });
});
