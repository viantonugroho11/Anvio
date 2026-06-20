import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export interface ObservabilityOptions {
  serviceName: string;
  otlpEndpoint?: string;
  enabled?: boolean;
}

export function initObservability(options: ObservabilityOptions): NodeSDK | null {
  if (options.enabled === false) return null;

  const endpoint = options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
    }),
    traceExporter: endpoint
      ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      : undefined,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  return sdk;
}

export async function shutdownObservability(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

export { trace, context, SpanStatusCode } from '@opentelemetry/api';
export {
  MetricsRegistry,
  getMetricsRegistry,
  resetMetricsRegistry,
} from './metrics-registry.js';
