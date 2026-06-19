import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { initObservability } from '@anvio/observability';

async function bootstrap() {
  initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'anvio-api',
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');

  const port = parseInt(process.env.API_PORT ?? '3000', 10);
  await app.listen(port, process.env.API_HOST ?? '0.0.0.0');
  console.log(`API listening on port ${port}`);
}

bootstrap();
