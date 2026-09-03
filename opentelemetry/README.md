# OpenTelemetry — Distributed Tracing

Demonstrates **distributed tracing** with OpenTelemetry across two Express services: an Order Service (with Prisma) calling a Payment Service. Traces are exported to Jaeger for visualisation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Docker Network                                 │
│                                                                        │
│  ┌──────────────┐        ┌──────────────────────┐        ┌───────────┐ │
│  │              │        │                      │        │           │ │
│  │  PostgreSQL  │◄───────│   Order Service      │        │  Jaeger   │ │
│  │  :5433       │  Prisma│   Express + Prisma   │        │  UI       │ │
│  │              │        │   :3000              │        │  :16686   │ │
│  └──────────────┘        │                      │        │           │ │
│                          │   tracing.ts ────────│───────►│  OTLP     │ │
│  ┌──────────────┐        │   (imported first)   │  :4318 │  :4318    │ │
│  │              │        └──────────┬───────────┘        └───────────┘ │
│  │  Payment     │                   │                                  │
│  │  Service     │◄──────────────────┘  POST /payments                  │
│  │  Express     │                   (traceparent header)              │
│  │  :3001       │                                                      │
│  │              │───────► Jaeger via OTLP (same trace)                │
│  │  tracing.ts ─│───────►                                            │
│  └──────────────┘                                                      │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
         ▲
         │
         │  POST /orders
         │
    ┌─────────┐
    │ Client  │
    └─────────┘
```

## Trace Flow

When a client creates an order, the following distributed trace is recorded across both services:

```
order-service                                          payment-service
─────────────                                          ───────────────
POST /orders
├─ create-order (root span)
│  ├─ insert-order
│  │  └─ Prisma: INSERT INTO "Order"
│  ├─ call-payment-service
│  │  └─ POST http://payment-service:3001/payments ──────► POST /payments
│  │     (traceparent header)                              ├─ process-payment
│  │                                                       │  └─ charge-card
│  └─ order.status = "paid"                               └─ return { id, status }
```

## Concepts Demonstrated

- **OTel SDK setup** — `NodeTracerProvider` with OTLP exporter
- **Auto-instrumentation** — Express and HTTP modules patched automatically
- **Manual spans** — business logic wrapped with `tracer.startSpan()`
- **Context propagation** — trace ID flows from Order to Payment via `traceparent` HTTP header
- **Span attributes** — `order.id`, `payment.amount`, etc. attached to spans
- **Error recording** — failed operations recorded as span exceptions

## How to Run

### Docker (recommended)

```bash
docker compose up -d --build
```

This starts:
- **Order Service** — `http://localhost:3000`
- **Payment Service** — `http://localhost:3001`
- **PostgreSQL** — `localhost:5433`
- **Jaeger UI** — `http://localhost:16686`

### Local Development

```bash
# Copy env file
cp .env.example .env

# Start infrastructure
docker compose up -d postgres jaeger

# Install dependencies
pnpm install

# Run migrations
pnpm db:migrate

# Start services (in separate terminals)
pnpm --filter order-service dev
pnpm --filter payment-service dev
```

## Try It

Create an order:

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"productId": "prod-123", "quantity": 2}'
```

Response:

```json
{
  "order": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "productId": "prod-123",
    "quantity": 2,
    "status": "paid",
    "createdAt": "2025-01-01T00:00:00.000Z"
  },
  "payment": {
    "id": "pay-1234567890",
    "orderId": "550e8400-e29b-41d4-a716-446655440000",
    "amount": 29.99,
    "status": "completed"
  }
}
```

Open Jaeger UI at `http://localhost:16686` and select **order-service** to see the trace waterfall.

## Project Structure

```
opentelemetry/
├── docker-compose.yml
├── order-service/
│   ├── src/
│   │   ├── tracing.ts      ← OTel setup (imported first)
│   │   ├── index.ts         ← Express app
│   │   └── routes/orders.ts ← Manual spans
│   └── prisma/schema.prisma
└── payment-service/
    ├── src/
    │   ├── tracing.ts      ← OTel setup (imported first)
    │   ├── index.ts         ← Express app
    │   └── routes/payments.ts
```

## Reference

For the full concept explanation, see [Distributed Tracing](../docs/distributed-tracing.md).
