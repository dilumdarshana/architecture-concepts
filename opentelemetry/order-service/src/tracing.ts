// tracing.ts — MUST be imported before any other module.
//
// When this file is imported, it patches Node's http/https modules and Express
// so that every incoming/outgoing request automatically creates a span.
// This must happen before express, prisma, or any other library imports their
// own http clients — otherwise those calls won't be instrumented.
//
// See: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/

import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Exporter: sends completed spans to a backend (Jaeger, Tempo, Datadog, etc.)
// via OTLP over HTTP. The endpoint is configured via environment variable.
const exporter = new OTLPTraceExporter({
  url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces`,
});

// Provider: manages the lifecycle of tracers and span processors.
// SimpleSpanProcessor exports each span immediately (no batching) —
// good for development. Use BatchSpanProcessor in production.
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [SemanticResourceAttributes.SERVICE_NAME]: 'order-service',
  }),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

// Register as the global tracer provider so trace.getTracer() works anywhere.
provider.register();

// Auto-instrumentation: patches Express and HTTP modules to create spans
// automatically. No manual instrumentation needed for basic request tracing.
registerInstrumentations({
  instrumentations: [
    new ExpressInstrumentation(),
    new HttpInstrumentation(),
  ],
});

console.log('[tracing] OpenTelemetry initialized — exporting to', process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318');
