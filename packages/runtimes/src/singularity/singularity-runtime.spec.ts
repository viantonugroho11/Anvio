import { afterEach, describe, expect, it } from 'vitest';
import { SingularityRuntimeProvider } from './singularity-runtime.js';

describe('SingularityRuntimeProvider', () => {
  const originalMock = process.env.ANVIO_SINGULARITY_MOCK;
  const originalImage = process.env.SINGULARITY_IMAGE;

  afterEach(() => {
    if (originalMock === undefined) delete process.env.ANVIO_SINGULARITY_MOCK;
    else process.env.ANVIO_SINGULARITY_MOCK = originalMock;
    if (originalImage === undefined) delete process.env.SINGULARITY_IMAGE;
    else process.env.SINGULARITY_IMAGE = originalImage;
  });

  it('is not configured without image or mock mode', () => {
    delete process.env.ANVIO_SINGULARITY_MOCK;
    delete process.env.SINGULARITY_IMAGE;
    const provider = new SingularityRuntimeProvider();
    expect(provider.isConfigured()).toBe(false);
  });

  it('is configured in mock mode', () => {
    process.env.ANVIO_SINGULARITY_MOCK = '1';
    const provider = new SingularityRuntimeProvider();
    expect(provider.isConfigured()).toBe(true);
  });

  it('execRemote runs locally in mock mode', async () => {
    process.env.ANVIO_SINGULARITY_MOCK = '1';
    const provider = new SingularityRuntimeProvider();
    const result = await provider.execRemote('echo hello-singularity');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello-singularity');
  });

  it('execRemote throws when no image is configured', async () => {
    delete process.env.ANVIO_SINGULARITY_MOCK;
    delete process.env.SINGULARITY_IMAGE;
    const provider = new SingularityRuntimeProvider();
    await expect(provider.execRemote('echo hi')).rejects.toThrow(/not configured/);
  });

  it('run() rejects — exec-only runtime', async () => {
    process.env.ANVIO_SINGULARITY_MOCK = '1';
    const provider = new SingularityRuntimeProvider();
    await expect(
      provider.run({
        session: { id: 's1' } as never,
        agent: {} as never,
        input: { content: 'echo hi' } as never,
      }),
    ).rejects.toThrow(/exec/);
  });

  it('capabilities report no streaming/tools/mcp', () => {
    const provider = new SingularityRuntimeProvider();
    const caps = provider.capabilities();
    expect(caps.supportsStreaming).toBe(false);
    expect(caps.supportsTools).toBe(false);
    expect(caps.supportsMcp).toBe(false);
  });
});
