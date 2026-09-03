# Distributed Tracing

> Tracking a single request as it travels through multiple services, recording timing and context at each hop to debug latency, errors, and dependencies.

---

## What is it?

**Distributed Tracing** assigns every incoming request a unique **trace ID** that is propagated across all services involved in processing it. Each unit of work at a service is a **span** — a named, timed operation with metadata. Spans are collected, correlated by trace ID, and visualised as a waterfall diagram showing where time was spent and where errors occurred.

The key concepts:

| Term | Meaning |
|------|---------|
| **Trace** | End-to-end record of a single request as it flows through the system |
| **Span** | A single unit of work (e.g. an HTTP call, a DB query, a queue publish) |
| **Trace ID** | Unique identifier propagated across service boundaries |
| **Span ID** | Unique identifier for an individual span |
| **Parent Span ID** | Links a child span (e.g. a DB query) to its parent (e.g. the HTTP handler) |
| **Context Propagation** | Carrying trace+span IDs across HTTP headers, message queues, and process boundaries |

---

## Problem

In a [Distributed System](distributed-systems.md), a single request often touches multiple services — API gateway, order service, payment service, database, message queue. When something goes wrong:

- "The checkout is slow" — which service caused the delay? Order? Payment? A database query?
- "The order failed" — was it the inventory check, the payment charge, or the notification?
- "We see errors in the logs" — but they are spread across three services with no correlation.
- "Latency increased 2x" — is it the network, the database, or a specific external API call?

Traditional logging and metrics (dashboards, averages) cannot tell you what happened for a **single request** across service boundaries. Distributed tracing connects the dots.

---

## Example

### Instrumenting an Express Service with OpenTelemetry

OpenTelemetry is the standard for distributed tracing. It auto-instruments common libraries and lets you add custom spans:

```typescript
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { trace, Span, context, propagation } from '@opentelemetry/api';
import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

// Setup (runs once at startup)
// OTLP endpoint: Grafana Tempo, Jaeger, or any OTLP-compatible backend
const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
});
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

// Auto-instrument Express and HTTP
registerInstrumentations({
  instrumentations: [
    new ExpressInstrumentation(),
    new HttpInstrumentation(),
  ],
});

const app = express();
const prisma = new PrismaClient();

// Manual tracing around business logic
app.get('/orders/:id', async (req, res) => {
  const tracer = trace.getTracer('order-service');
  const span = tracer.startSpan('get-order-details');

  try {
    // Add custom attributes
    span.setAttribute('order.id', req.params.id);
    span.setAttribute('user.id', req.headers['x-user-id']);

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
    });

    // Create a child span for the payment lookup
    const paymentSpan = tracer.startSpan(
      'fetch-payment',
      { parent: span }
    );
    const payment = await fetchPaymentDetails(order.paymentId);
    paymentSpan.end();

    span.setStatus({ code: SpanStatusCode.OK });
    res.json({ order, payment });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
});
```

### Propagating Context Across HTTP Calls

When one service calls another, the trace context must be propagated via headers:

```typescript
import axios from 'axios';
import { context, propagation } from '@opentelemetry/api';

async function callInventoryService(productId: string) {
  const headers = {};

  // Inject current trace context into outgoing headers
  propagation.inject(context.active(), headers);

  const response = await axios.post(
    'https://inventory.service/reserve',
    { productId },
    { headers }  // Includes traceparent header
  );

  return response.data;
}
```

The downstream service (inventory) picks up the context from the `traceparent` header and continues the same trace.

### Tracing Message Queue Consumers

For BullMQ, a custom wrapper can trace job processing:

```typescript
import { Worker } from 'bullmq';
import { trace, context, propagation } from '@opentelemetry/api';

const tracer = trace.getTracer('notification-service');

const worker = new Worker('notifications', async (job) => {
  const span = tracer.startSpan(`process-job:${job.name}`, {
    attributes: {
      'job.id': job.id,
      'job.name': job.name,
    }
  });

  try {
    await processNotification(job.data);
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    throw err;
  } finally {
    span.end();
  }
});
```

---

## Architecture / Flow

```text
Trace: acb123
────────────────────────────────────────────────────────────────

Client           API Gateway         Order Svc         Payment Svc        Database
  │                   │                   │                  │               │
  │  POST /order      │                   │                  │               │
  ├──────────────────►│                   │                  │               │
  │                   │  Create order     │                  │               │
  │                   ├──────────────────►│                  │               │
  │                   │                   │  INSERT order    │               │
  │                   │                   ├─────────────────────────────────►│
  │                   │                   │◄─────────────────────────────────│
  │                   │                   │                  │               │
  │                   │                   │  Charge payment   │               │
  │                   │                   ├─────────────────►│               │
  │                   │                   │                  │  INSERT txn   │
  │                   │                   │                  ├──────────────►│
  │                   │                   │                  │◄──────────────│
  │                   │                   │◄─────────────────│               │
  │                   │◄──────────────────│                  │               │
  │◄──────────────────│                   │                  │               │
  │                   │                   │                  │               │

Spans:
  [ POST /order ]           [ Create order ]   [ INSERT order  ]
  [ validate auth  ]        [ validate stock ]  [ fetch payment ]
  [ route request  ]        [ charge payment ]  [ INSERT txn    ]
```

Each span records start time, end time, status, and attributes. The trace ID (`acb123`) links them all together.

---

## How it Works

1. A request enters the system at the edge (API gateway, load balancer, message consumer).
2. The first service creates a **trace ID** and starts the **root span** (e.g. `POST /orders`).
3. The trace context (trace ID, span ID) is propagated to downstream services via:
   - **HTTP** — the `traceparent` header (W3C Trace Context standard).
   - **Message queues** — injected into message headers or payload.
   - **Process boundaries** — propagated via environment variables or RPC metadata.
4. Each service creates **child spans** for internal work (DB queries, sub-calls, business logic).
5. Span data (name, timing, attributes, status) is exported to a **tracing backend** (Jaeger, Zipkin, Datadog, Grafana Tempo).
6. The backend correlates all spans by trace ID and renders a **waterfall diagram**.
7. Operators inspect the trace to identify the slowest span, error sources, and dependency failures.

---

## Advantages

| Advantage | Impact |
|-----------|--------|
| **End-to-end visibility** — see the full path of a single request across all services | No more guessing which service caused a slowdown |
| **Latency pinpointing** — each span shows exact duration; the slowest span is immediately visible | Identify database queries, external API calls, or serialisation as bottlenecks |
| **Error correlation** — errors from different services that belong to the same trace are grouped | No more searching multiple log files for related failures |
| **Dependency mapping** — traces reveal which services call which, in real time | Discover undocumented dependencies and unexpected call paths |
| **Sampling** — high-volume systems sample a percentage of traces (e.g. 1%) to control cost | Still get statistical visibility into system behaviour |

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Performance overhead** — generating and exporting spans adds CPU and memory per request | Mitigated by sampling; negligible for most applications (sub-millisecond per span) |
| **Infrastructure cost** — requires a tracing backend (Jaeger, Tempo, Datadog) and storage for span data | Can become expensive at high throughput; sampling controls cost |
| **Context propagation complexity** — every library and protocol must support trace header injection | OpenTelemetry auto-instrumentation covers most cases, but custom libraries need manual wiring |
| **Noise** — too much instrumentation creates thousands of spans per trace, obscuring useful signals | Requires careful span design and filtering; use span attributes, not excessive spans |
| **Privacy** — trace attributes may contain PII (user IDs, request bodies) | Must sanitise attributes before export or configure attribute filtering |

---

## When to Use

- Any [Distributed System](distributed-systems.md) with three or more services — tracing is the only way to debug cross-service requests
- Systems experiencing intermittent latency or hard-to-reproduce errors
- Performance optimisation — identify which service or query is the bottleneck in a request path
- Compliance and audit — traces provide a detailed record of a request's path through the system

---

## When NOT to Use

- Single-process applications — a profiler or event loop diagnostic tool is simpler
- Systems with very low observability budgets where logging and metrics alone are sufficient
- Environments where the overhead of running a tracing backend is not justified (small prototypes, short-lived projects)
- Systems where request volume is extremely high and traces cannot be sampled meaningfully

---

## Related Concepts

- [Distributed Systems](distributed-systems.md) — tracing is essential observability for any multi-service architecture
- [Graceful Shutdown](graceful-shutdown.md) — shutdown errors can be captured as spans to verify clean drain
- [Error Handling (Express)](error-handling.md) — span status and error recording should happen in the error middleware
- [Saga Pattern](saga-pattern.md) — each saga step creates spans; traces show the full saga execution path
- [Cancellation & Timeouts](cancellation-timeouts.md) — cancelled operations should be recorded as spans with `aborted` status
- OpenTelemetry
- W3C Trace Context
- Jaeger / Zipkin / Grafana Tempo / Datadog APM
- Log Correlation

---

## Key Takeaways

> Distributed Tracing correlates a single request across all services it passes through using a shared trace ID. Each service records spans (timed units of work) that are collected and visualised as a waterfall diagram. OpenTelemetry is the standard instrumentation library. Use distributed tracing to debug latency, discover dependencies, and correlate errors across service boundaries — essential observability for any distributed system with three or more services.
