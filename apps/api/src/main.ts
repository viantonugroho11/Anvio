import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { initObservability, shutdownObservability } from '@anvio/observability';
import { AppModule } from './app.module.js';

async function bootstrap() {
  initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'anvio-api',
    enabled: process.env.ANVIO_OTEL_ENABLED === 'true' || !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');

  const port = parseInt(process.env.API_PORT ?? '3000', 10);
  await app.listen(port, process.env.API_HOST ?? '0.0.0.0');
  console.log(`API listening on port ${port} (auth optional — see workspace/anvio.yaml)`);

  const shutdown = async () => {
    await app.close();
    await shutdownObservability();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
