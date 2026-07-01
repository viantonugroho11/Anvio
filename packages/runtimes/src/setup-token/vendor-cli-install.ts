import { AnvioError } from '@anvio/core';
import { combinedOutput, spawnVendorCli } from './spawn-vendor-cli.js';

export const ANTIGRAVITY_CLI_INSTALL_URL = 'https://antigravity.google/cli/install.sh';

/** Augment PATH with ~/.local/bin (default Antigravity CLI install location). */
export function vendorCliEnvWithLocalBin(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) return env;

  const localBin = `${home}/.local/bin`;
  const pathValue = env.PATH ?? '';
  const segments = pathValue.split(':').filter(Boolean);
  if (segments.includes(localBin)) return env;

  return { ...env, PATH: pathValue ? `${localBin}:${pathValue}` : localBin };
}

export async function commandExists(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const result = await spawnVendorCli({
    binary: 'bash',
    args: ['-lc', `command -v ${binary}`],
    env,
    timeoutMs: 15_000,
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

/** Run official vendor install script (curl | bash). macOS/Linux only. */
export async function runRemoteInstallScript(
  url: string,
  timeoutMs = 600_000,
): Promise<string> {
  const result = await spawnVendorCli({
    binary: 'bash',
    args: ['-c', `curl -fsSL "${url}" | bash`],
    timeoutMs,
  });
  const output = combinedOutput(result);
  if (result.exitCode !== 0) {
    throw new AnvioError(
      'VALIDATION_ERROR',
      `Vendor install script failed (${url}):\n${output || 'no output'}`,
    );
  }
  return output;
}

export interface EnsureAntigravityCliOptions {
  binary?: string;
  autoInstall?: boolean;
  installUrl?: string;
  timeoutMs?: number;
}

export interface EnsureAntigravityCliResult {
  binary: string;
  env: NodeJS.ProcessEnv;
  installed: boolean;
}

/** Resolve `agy` on PATH; optionally run Google's official install script. */
export async function ensureAntigravityCli(
  options: EnsureAntigravityCliOptions = {},
): Promise<EnsureAntigravityCliResult> {
  const binary = options.binary ?? 'agy';
  const autoInstall = options.autoInstall !== false;
  const installUrl = options.installUrl ?? ANTIGRAVITY_CLI_INSTALL_URL;
  const timeoutMs = options.timeoutMs ?? 600_000;

  let env = vendorCliEnvWithLocalBin();
  let installed = false;

  if (!(await commandExists(binary, env))) {
    if (!autoInstall) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        [
          `Antigravity CLI (\`${binary}\`) not found on PATH.`,
          `Install manually: curl -fsSL ${installUrl} | bash`,
          'Or rerun without --no-install to let Anvio install it automatically.',
        ].join('\n'),
      );
    }

    await runRemoteInstallScript(installUrl, timeoutMs);
    env = vendorCliEnvWithLocalBin();
    installed = true;

    if (!(await commandExists(binary, env))) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        [
          `Antigravity CLI install finished but \`${binary}\` is still not on PATH.`,
          'Ensure ~/.local/bin is in PATH, then retry.',
        ].join('\n'),
      );
    }
  }

  return { binary, env, installed };
}
