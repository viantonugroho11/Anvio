import { initObservability, shutdownObservability } from '@anvio/observability';
import {
  createPlatform,
  exitOnShutdownSignals,
  installProcessErrorGuards,
  registerGatewayWorker,
  runShutdownSteps,
} from '@anvio/platform';

async function main() {
  installProcessErrorGuards('worker');
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

  exitOnShutdownSignals('worker', () =>
    runShutdownSteps('worker', [
      { name: 'platform', run: () => platform.shutdown() },
      { name: 'observability', run: () => shutdownObservability() },
    ]),
  );
}

// A failed boot must exit non-zero, or a supervisor treats it as a clean stop.
main().catch((err) => {
  console.error('[worker] failed to start:', err);
  process.exit(1);
});
