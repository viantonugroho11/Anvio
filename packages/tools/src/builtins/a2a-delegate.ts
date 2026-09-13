import type { BuiltinToolResult } from '@anvio/core';

export type A2ADelegateFn = (
  alias: string,
  message: string,
  contextId?: string,
) => Promise<{ taskId: string; status: string; content: string }>;

export async function a2aDelegateTool(
  delegate: A2ADelegateFn | undefined,
  args: { alias: string; message: string; contextId?: string },
): Promise<BuiltinToolResult> {
  if (!delegate) throw new Error('A2A delegation not configured — add remotes to a2a config');

  const result = await delegate(args.alias, args.message, args.contextId);
  return {
    name: 'a2a_delegate',
    output: {
      taskId: result.taskId,
      status: result.status,
      content: result.content,
    },
    status: 'completed',
  };
}
