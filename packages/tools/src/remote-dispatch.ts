import type { BuiltinToolCall, BuiltinToolResult, ExecTarget } from '@anvio/core';
import { RemoteExecError } from '@anvio/core';

/** Tools that run on the bound remote target instead of the host (ADR 0034). */
export const REMOTE_ROUTED_TOOLS = new Set([
  'file_read',
  'file_write',
  'list_dir',
  'edit_file',
  'run_shell',
  'terminal',
]);

/**
 * Tools that touch the host filesystem or processes but have no remote implementation.
 * While a session is bound to a remote target they are refused, so the agent never
 * silently acts on the host when the user expects their own machine.
 */
export const HOST_ONLY_TOOLS = new Set([
  'execute_code',
  'execute_code_pipeline',
  'glob_files',
  'grep_search',
  'path_exists',
  'file_delete',
  'append_file',
  'patch_file',
  'search_files',
  'process',
]);

const SHELL_TIMEOUT_MS = 120_000;

function fail(call: BuiltinToolCall, error: string): BuiltinToolResult {
  return { name: call.name, output: null, status: 'failed', error };
}

export async function runRemoteTool(
  target: ExecTarget,
  toolKey: string,
  call: BuiltinToolCall,
): Promise<BuiltinToolResult> {
  const args = call.arguments;
  const path = String(args.path ?? '.');
  try {
    switch (toolKey) {
      case 'file_read':
        return { name: call.name, output: { path, content: await target.readFile(path, 16_000) }, status: 'completed' };
      case 'file_write': {
        const content = String(args.content ?? '');
        await target.writeFile(path, content);
        return { name: call.name, output: { path, bytes: Buffer.byteLength(content, 'utf-8') }, status: 'completed' };
      }
      case 'list_dir':
        return { name: call.name, output: { path, entries: await target.listDir(path) }, status: 'completed' };
      case 'edit_file': {
        const oldString = String(args.old_string ?? '');
        const newString = String(args.new_string ?? '');
        const content = await target.readFile(path, Number.MAX_SAFE_INTEGER);
        if (!content.includes(oldString)) return fail(call, 'old_string not found in file');
        const replacements = args.replace_all ? content.split(oldString).length - 1 : 1;
        const updated = args.replace_all
          ? content.replaceAll(oldString, newString)
          : content.replace(oldString, newString);
        await target.writeFile(path, updated);
        return { name: call.name, output: { path, replacements }, status: 'completed' };
      }
      case 'run_shell':
      case 'terminal': {
        if (toolKey === 'terminal' && args.background) {
          return fail(call, 'background processes are not supported on a remote target');
        }
        const command = String(args.command ?? '');
        const out = await target.exec(command, { timeoutMs: SHELL_TIMEOUT_MS, login: true });
        const exitCode = out.code ?? -1;
        return {
          name: call.name,
          output: { command, stdout: out.stdout, stderr: out.stderr, exitCode, truncated: out.truncated, timedOut: out.timedOut },
          status: exitCode === 0 ? 'completed' : 'failed',
          error: exitCode === 0 ? undefined : out.timedOut ? 'timed out' : out.stderr,
        };
      }
      default:
        return fail(call, `${toolKey} has no remote implementation`);
    }
  } catch (error) {
    if (error instanceof RemoteExecError) {
      // Surface `started` so the model does not blindly re-run a command that may have executed.
      return fail(call, error.started ? `${error.message} (command may have run; do not retry blindly)` : error.message);
    }
    return fail(call, error instanceof Error ? error.message : String(error));
  }
}
