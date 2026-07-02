import { spawnSync } from 'node:child_process';
import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';
import type { RemoteExecResult } from '../remote/remote-runtime-stub.js';

export interface SingularityRuntimeOptions {
  /** Path to the `singularity`/`apptainer` binary. Defaults to `singularity`. */
  binary?: string;
  /** SIF image path or URL (e.g. `docker://ubuntu`, `/path/to/image.sif`). */
  image?: string;
}

/**
 * Singularity/Apptainer container runtime — HPC-oriented rootless container
 * execution (SIF images). Unlike the Daytona/Modal remote-API stubs, this
 * shells out to a local `singularity`/`apptainer` binary, following the same
 * "local process" pattern as {@link DockerRuntimeProvider} and
 * {@link SshRuntimeProvider}.
 *
 * Set `ANVIO_SINGULARITY_MOCK=1` to exercise the exec path without the
 * binary or an image installed (runs commands via `sh -c` locally).
 */
export class SingularityRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'singularity' as const;

  constructor(private readonly options: SingularityRuntimeOptions = {}) {}

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: false,
      supportsStreaming: false,
      supportsSubagents: false,
      supportsMcp: false,
      supportedLanguages: ['shell', 'python'],
    };
  }

  private binary(): string {
    return this.options.binary ?? process.env.SINGULARITY_BINARY ?? 'singularity';
  }

  private image(): string | undefined {
    return this.options.image ?? process.env.SINGULARITY_IMAGE;
  }

  private isMockMode(): boolean {
    return process.env.ANVIO_SINGULARITY_MOCK === '1';
  }

  isConfigured(): boolean {
    if (this.isMockMode()) return true;
    if (!this.image()) return false;
    const probe = spawnSync(this.binary(), ['--version'], { encoding: 'utf-8' });
    return probe.status === 0;
  }

  private notConfiguredMessage(): string {
    return 'singularity runtime is not configured. Install singularity/apptainer and set SINGULARITY_IMAGE (SIF path or docker:// URI), or set ANVIO_SINGULARITY_MOCK=1 for local dev.';
  }

  /** Execute a shell command inside the configured SIF container. */
  async execRemote(command: string): Promise<RemoteExecResult> {
    if (this.isMockMode()) {
      const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
      return {
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
        exitCode: result.status ?? 1,
      };
    }

    const image = this.image();
    if (!image) {
      throw new AnvioError('VALIDATION_ERROR', this.notConfiguredMessage());
    }

    const result = spawnSync(this.binary(), ['exec', image, 'sh', '-c', command], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (result.error) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        `${this.notConfiguredMessage()} (${result.error.message})`,
      );
    }
    return {
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
      exitCode: result.status ?? 1,
    };
  }

  async run(_request: RuntimeRequest): Promise<RuntimeResult> {
    throw new AnvioError(
      'VALIDATION_ERROR',
      'Singularity runtime executes container commands only — use `anvio runtime exec singularity -- <cmd>`',
    );
  }

  async *stream(_request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'error', error: 'Singularity runtime does not support agent streaming yet' };
  }
}
