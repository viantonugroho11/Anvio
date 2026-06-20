import type { BuiltinToolCall } from '@anvio/core';

const TOOL_FENCE_RE = /```anvio_tool\s*\n([\s\S]*?)\n```/g;

export function parseToolCalls(content: string): BuiltinToolCall[] {
  const calls: BuiltinToolCall[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(TOOL_FENCE_RE)) {
    const parsed = parseToolJson(match[1]?.trim() ?? '');
    if (parsed && !seen.has(parsed.name)) {
      seen.add(parsed.name);
      calls.push(parsed);
    }
  }

  if (calls.length === 0) {
    for (const match of content.matchAll(/\{[\s\S]*?\}/g)) {
      const parsed = parseToolJson(match[0] ?? '');
      if (parsed && !seen.has(parsed.name)) {
        seen.add(parsed.name);
        calls.push(parsed);
      }
    }
  }

  return calls;
}

function parseToolJson(raw: string): BuiltinToolCall | undefined {
  try {
    const value = JSON.parse(raw) as {
      name?: string;
      tool?: string;
      arguments?: Record<string, unknown>;
      args?: Record<string, unknown>;
    };
    const name = value.name ?? value.tool;
    if (!name?.startsWith('anvio_tools__')) return undefined;
    return {
      name,
      arguments: value.arguments ?? value.args ?? {},
    };
  } catch {
    return undefined;
  }
}

export function stripToolCalls(content: string): string {
  return content.replace(TOOL_FENCE_RE, '').trim();
}

export function formatToolResultMessage(name: string, output: unknown, error?: string): string {
  if (error) {
    return `Tool ${name} failed:\n${error}`;
  }
  const body =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return `Tool ${name} result:\n${body}`;
}
