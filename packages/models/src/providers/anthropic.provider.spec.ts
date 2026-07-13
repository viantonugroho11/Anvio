import { describe, expect, it } from 'vitest';
import { toAnthropicSystem, toAnthropicTools } from './anthropic.provider.js';

const tools = [
  { name: 'a', description: 'tool a', inputSchema: { type: 'object' } },
  { name: 'b', description: 'tool b', inputSchema: { type: 'object' } },
];

describe('toAnthropicSystem', () => {
  it('tags system prompt as a cacheable block when enabled', () => {
    expect(toAnthropicSystem('You are helpful.', true)).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('passes plain string through when caching disabled', () => {
    expect(toAnthropicSystem('You are helpful.', false)).toBe('You are helpful.');
  });

  it('leaves empty/undefined prompt untouched', () => {
    expect(toAnthropicSystem(undefined, true)).toBeUndefined();
    expect(toAnthropicSystem('', true)).toBe('');
  });
});

describe('toAnthropicTools', () => {
  it('tags only the last tool as a cache breakpoint when enabled', () => {
    const mapped = toAnthropicTools(tools, true)!;
    expect(mapped[0]).not.toHaveProperty('cache_control');
    expect(mapped[1]).toMatchObject({ name: 'b', cache_control: { type: 'ephemeral' } });
  });

  it('adds no cache_control when disabled', () => {
    const mapped = toAnthropicTools(tools, false)!;
    expect(mapped.every((t) => !('cache_control' in t))).toBe(true);
  });

  it('handles undefined and empty tool lists', () => {
    expect(toAnthropicTools(undefined, true)).toBeUndefined();
    expect(toAnthropicTools([], true)).toEqual([]);
  });
});
