import { createRequire } from 'node:module';

export interface CodexCommand {
  binary: string;
  /** Args placed before the codex subcommand (e.g. the bundled launcher script). */
  prefixArgs: string[];
}

const require = createRequire(import.meta.url);

/**
 * Resolve how to invoke the Codex CLI.
 *
 * Priority: explicit `binary` override → CLI bundled via the `@openai/codex`
 * dependency (run through the current Node, so no global install is needed)
 * → `codex` on PATH.
 */
export function resolveCodexCommand(
  binary?: string,
  resolve: (id: string) => string = require.resolve,
): CodexCommand {
  if (binary) return { binary, prefixArgs: [] };
  try {
    const launcher = resolve('@openai/codex/bin/codex.js');
    return { binary: process.execPath, prefixArgs: [launcher] };
  } catch {
    return { binary: 'codex', prefixArgs: [] };
  }
}
