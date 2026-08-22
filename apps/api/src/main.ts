import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { initObservability, shutdownObservability } from '@anvio/observability';
import { AppModule } from './app.module.js';
import { AppService } from './app.service.js';
import { assertSafeBinding, isLoopbackHost, resolveApiBinding } from './security.js';

async function bootstrap() {
  initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'anvio-api',
    enabled: process.env.ANVIO_OTEL_ENABLED === 'true' || !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const app = await NestFactory.create(AppModule);
  const binding = resolveApiBinding(process.env);

  // Order matters twice over. Routes and middleware are registered during
  // `init()`, so the prefix and CORS policy have to be set before it — and
  // `AppService.platform` is assigned in `onModuleInit`, which only `init()`
  // fires, so the safety check has to come after it. `listen()` would init on
  // its own, but by then the port is open, and the check exists to decide
  // whether to open it at all.
  app.enableCors({ origin: binding.corsOrigin, credentials: true });
  app.setGlobalPrefix('api');

  await app.init();

  const appService = app.get(AppService);
  const authEnabled = appService.platform.auth.enabled;
  assertSafeBinding({
    host: binding.host,
    authEnabled,
    allowInsecure: binding.allowInsecure,
  });

  await app.listen(binding.port, binding.host);

  const reach = isLoopbackHost(binding.host) ? 'this machine only' : `reachable on ${binding.host}`;
  console.log(
    `API listening on ${binding.host}:${binding.port} — ${reach}, ` +
      `auth ${authEnabled ? 'enabled' : 'disabled'}`,
  );
  if (!authEnabled && !isLoopbackHost(binding.host)) {
    console.warn(
      'WARNING: serving an unauthenticated API beyond loopback because ' +
        'ANVIO_API_ALLOW_INSECURE=true. Anything that can reach this host can spend model credits.',
    );
  }

  const shutdown = async () => {
    await app.close();
    await shutdownObservability();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
