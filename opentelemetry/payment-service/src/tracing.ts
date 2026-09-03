// tracing.ts — MUST be imported before any other module.
//
// Same setup as order-service. Each service initializes its own tracer provider
// and exports spans independently. The trace context is propagated between
// services via HTTP headers (traceparent), not shared state.

import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const exporter = new OTLPTraceExporter({
  url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces`,
});

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: 'payment-service',
  }),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

provider.register();

registerInstrumentations({
  instrumentations: [
    new ExpressInstrumentation(),
    new HttpInstrumentation(),
  ],
});

console.log('[tracing] OpenTelemetry initialized — exporting to', process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318');
