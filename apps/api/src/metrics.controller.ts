import { Controller, Get, Header } from '@nestjs/common';
import { getMetricsRegistry } from '@anvio/observability';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics(): string {
    return getMetricsRegistry().toPrometheusText();
  }
}
