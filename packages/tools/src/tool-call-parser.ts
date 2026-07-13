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

/** Max characters of a tool result entering model context (ADR-0010 layer 3). Override via ANVIO_TOOL_OUTPUT_MAX_CHARS; 0 disables clipping. */
export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 30_000;

function toolOutputBudget(): number {
  const raw = process.env.ANVIO_TOOL_OUTPUT_MAX_CHARS;
  if (raw == null || raw === '') return DEFAULT_TOOL_OUTPUT_MAX_CHARS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOOL_OUTPUT_MAX_CHARS;
}

/** Head/tail clip oversized tool output so a single result cannot flood the context window. */
export function clipToolOutput(body: string, maxChars = toolOutputBudget()): string {
  if (maxChars <= 0 || body.length <= maxChars) return body;
  const headLen = Math.floor(maxChars * 0.7);
  const tailLen = maxChars - headLen;
  const omitted = body.length - maxChars;
  return `${body.slice(0, headLen)}\n\n[... tool output clipped: ${omitted} characters omitted ...]\n\n${body.slice(-tailLen)}`;
}

export function formatToolResultMessage(name: string, output: unknown, error?: string): string {
  if (error) {
    return `Tool ${name} failed:\n${clipToolOutput(error)}`;
  }
  const body =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return `Tool ${name} result:\n${clipToolOutput(body)}`;
}
