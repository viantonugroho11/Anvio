import { initObservability, shutdownObservability } from '@anvio/observability';
import { createPlatform, registerGatewayWorker } from '@anvio/platform';

async function main() {
  initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'anvio-worker',
    enabled: process.env.ANVIO_OTEL_ENABLED === 'true' || !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const platform = await createPlatform({
    workspacePath: process.env.ANVIO_WORKSPACE,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  await registerGatewayWorker(platform);
  console.log('Worker ready — use `anvio gateway start` for unified Hermes-style daemon');

  process.on('SIGINT', async () => {
    await platform.channelHub.stopAll();
    await platform.eventBus.close();
    await shutdownObservability();
    process.exit(0);
  });
}

main().catch(console.error);
