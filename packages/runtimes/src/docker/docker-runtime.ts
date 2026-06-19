import type {
  CodeExecutor,
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { spawnSync } from 'node:child_process';

export interface DockerRuntimeOptions {
  image?: string;
  codeExecutor?: CodeExecutor;
}

/** First-class Docker runtime — delegates to sandboxed CodeExecutor when available. */
export class DockerRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'docker' as const;

  constructor(private readonly options: DockerRuntimeOptions = {}) {}

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: false,
      supportsStreaming: false,
      supportsSubagents: false,
      supportsMcp: false,
      supportedLanguages: ['javascript', 'python', 'shell'],
    };
  }

  isConfigured(): boolean {
    if (process.env.ANVIO_DOCKER_MOCK === '1') return true;
    const probe = spawnSync('docker', ['info'], { encoding: 'utf-8' });
    return probe.status === 0;
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    if (!this.options.codeExecutor) {
      throw new Error('Docker runtime requires CodeExecutor');
    }
    const result = await this.options.codeExecutor.execute({
      code: request.input.content,
      runtime: 'docker',
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });
    return {
      sessionId: request.session.id,
      content: result.stdout || result.stderr,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      status: result.exitCode === 0 ? 'completed' : 'failed',
      runtimeId: 'docker',
    };
  }

  async *stream(_request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'error', error: 'Docker runtime does not support streaming yet' };
  }
}
