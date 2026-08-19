# E-Commerce Platform — A Reference Architecture

> A practical distributed system applying multiple architectural patterns together in an e-commerce domain, showing how each concept composes in a real system.

---

## What is it?

This is a reference architecture for an e-commerce platform built as a set of [Distributed Systems](distributed-systems.md). It demonstrates how multiple architectural patterns work together to solve real-world problems like reliable messaging, distributed transactions, scalable reads, and fault tolerance.

The system models: order management, payment processing, inventory reservation, and customer notifications.

---

## Problem

Building an e-commerce platform as a monolith creates bottlenecks:

- A single database becomes a contention point under high traffic
- Order, payment, and inventory logic are tightly coupled
- A spike in one domain (e.g. flash sale) impacts unrelated features
- Multiple teams cannot deploy independently

Moving to a distributed system introduces new challenges: the [dual-write problem](outbox-pattern.md#problem), distributed transaction coordination, eventual consistency, and service resilience. Each pattern in this reference solves one of those challenges.

---

## System Architecture

Each service runs on Node.js, which uses [Concurrency vs Parallelism](concurrency-vs-parallelism.md) to handle many requests efficiently:

- **Concurrency** — the event loop manages thousands of simultaneous I/O operations (DB queries, HTTP calls) per service without threading overhead.
- **Parallelism** — CPU-bound work (image resizing for product photos, PDF invoice generation) is offloaded to worker threads so the event loop stays responsive.

```text
                           Client
                              │
                              ▼
                        API Gateway
                     (Express / Fastify)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   Order Service      Payment Service       Inventory Service
   (Express +         (Express +             (Express +
    Prisma)             Prisma)               Prisma)
          │                   │                   │
          │              ┌────┴────┐              │
          │              ▼         ▼              │
          │         Stripe    Ledger              │
          │           │         │                 │
          └───────────┼─────────┼─────────────────┘
                      ▼         ▼
              Message Queue (Bull / Redis)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
  Notification Service      Analytics Service
      (Bull consumer)        (CQRS reads)
```

---

## Pattern Map

Each architectural pattern maps to a specific problem area:

| Pattern | Applied In |
|---------|------------|
| [Outbox Pattern](outbox-pattern.md) | Order Service publishes `OrderCreated`/`PaymentConfirmed` without dual-write risk |
| [Saga Pattern](saga-pattern.md) | Checkout flow coordinates Order, Payment, and Inventory services (choreography style) |
| [CQRS](cqrs.md) | Analytics Service maintains denormalised read models built from the event stream |
| [Consensus Algorithms](consensus-algorithms.md) | etcd or Raft-based coordination for failover and config management |
| [Consistency Models](consistency-models.md) | Order Service uses strong consistency for inventory; eventual consistency for notifications |
| [Consistent Hashing](consistent-hashing.md) | Redis Cluster uses consistent hashing for cache key distribution |
| [Distributed Cache](distributed-cache.md) | Redis Cluster partitions the product catalog cache across nodes and replicates it for availability |
| [Event Sourcing](event-sourcing.md) | Payment Service stores ledger as an append-only event stream |
| [Service Discovery](service-discovery.md) | Kubernetes DNS resolves service names to healthy pod IPs |
| [Backpressure](backpressure.md) | Queue workers limit concurrency; streams use backpressure-aware piping |
| [Bulkhead Pattern](bulkhead-pattern.md) | Each service has dedicated connection pools per downstream dependency |
| [Circuit Breaker](circuit-breaker.md) | Order Service wraps downstream Payment API calls with opossum |
| [Caching Strategies](caching-strategies.md) | Redis cache-aside for user profiles, product catalog, and reference data; write-invalidate on data update |
| [Idempotency](idempotency.md) | Payment Service deduplicates charge requests on retry |
| [Retry Pattern](retry-pattern.md) | BullMQ workers use exponential backoff + jitter for payment and notification jobs |
| Message Queue (BullMQ) | Async communication between services via Redis |
| [Message Queues](message-queues.md) | BullMQ for order processing; SQS for cross-region event delivery; DLQ for permanently failed payment jobs |
| [gRPC](grpc.md) | Inter-service RPC for typed, streaming communication (alternative to REST for synchronous calls) |
| [GraphQL](graphql.md) | API Gateway optionally exposes a GraphQL endpoint for flexible client-driven queries |
| API Gateway | Single entry point with routing, auth, rate limiting |
| [Distributed Tracing](distributed-tracing.md) | OpenTelemetry traces every request across all services, correlated by trace ID |
| [Leader Election](leader-election.md) | Singleton batch job coordinator (report generation, cache warming) |
| [Replication](replication.md) | PostgreSQL streaming replication for database HA; read replicas for analytics queries |
| [Sharding](sharding.md) | Order data sharded by customer_id for horizontal write scaling |
| [Rate Limiting](rate-limiting.md) | API Gateway enforces per-client rate limits with token bucket |
| [Database Concurrency Control](database-concurrency-control.md) | Inventory Service uses pessimistic locking during flash sales; all services use transactions for atomic writes |
| [Promise APIs](promise-apis.md) | Dashboard endpoint uses `Promise.all` for parallel user/order/recommendation queries; Notification Service uses `Promise.allSettled` for batch email dispatch |
| [Distributed Transactions](distributed-transactions.md) | Explicitly avoided — Saga + Outbox + Idempotency provide eventual consistency without 2PC overhead |
| [Delivery Semantics](delivery-semantics.md) | All services use at-least-once delivery via SQS/Bull; Payment Service upgrades to exactly-once via idempotency keys |
| [Graceful Shutdown](graceful-shutdown.md) | Every service implements signal handlers to drain queues, track in-flight requests, and close keep-alive sockets during rolling deployments |
| [Handling Eventual Consistency](handling-eventual-consistency.md) | Dashboard uses polling for near-real-time data; Notification Service accepts staleness; Order Service applies read-your-writes for user-facing queries |
| [Error Handling (Express)](error-handling.md) | Every service uses asyncHandler wrapper and centralized error middleware for consistent error responses |
| [Cancellation & Timeouts](cancellation-timeouts.md) | HTTP routes use AbortController to cancel DB queries on client disconnect; outbox publisher uses timeout to prevent hung pollers |
| [Event Loop](event-loop.md) | Every Node.js service runs on the event loop; understanding phases prevents blocking and starvation |
| [Claim-Check Pattern](claim-check-pattern.md) | Inventory Service uses `SELECT ... FOR UPDATE SKIP LOCKED` on reservation rows to prevent concurrent overselling |
| [Event Versioning](event-versioning.md) | All services version event schemas for backward compatibility; consumers use upcast functions to handle older event versions |
| [API Versioning](api-versioning.md) | API Gateway mounts versioned Express routers (`/api/v1`, `/api/v2`) with deprecation headers and sunset timelines |
| [API Authentication](api-authentication.md) | API Gateway validates OIDC bearer tokens (OAuth 2.0 Authorization Code + PKCE) and enforces role-based authorization on all `/api` routes |
| [OAuth 2.0](oauth2.md) | API Gateway validates access tokens against Keycloak's JWKS; scopes gate `/api` routes |
| [OpenID Connect (OIDC)](oidc.md) | Keycloak issues OIDC ID tokens; the gateway verifies identity before role-based authorization |
| [API Security (OWASP Top 10)](owasp-top-10.md) | All queries parameterised via Prisma (SQL injection); ownership checks prevent IDOR; gateway enforces authN/authZ on every route |
| [Rollout Strategies](rollout-strategies.md) | Feature flags control gradual rollout of new checkout flow; percentage routing for canary deployments |
| [Database Migrations](database-migrations.md) | Expand-migrate-contract pattern for zero-downtime schema changes across rolling deploys |
| [Testing Event-Driven Systems](testing-event-driven-systems.md) | In-memory event store for unit tests; integration tests with testcontainers for projections and handlers |

---

## Flow: Place Order (Saga)

The checkout flow uses the [Saga Pattern](saga-pattern.md) (choreography style) to coordinate a distributed transaction across three services.

### Step-by-Step

1. Client sends `POST /orders` to the API Gateway.
2. Gateway forwards to Order Service.
3. Order Service creates an order with `status: pending` and publishes `OrderCreated` via the [Outbox Pattern](outbox-pattern.md).
4. Inventory Service consumes the event and reserves items. On success, it publishes `InventoryReserved`.
5. Payment Service consumes `InventoryReserved` and charges the customer. On success, it publishes `PaymentConfirmed`.
6. Order Service consumes `PaymentConfirmed` and updates the order to `status: confirmed`.
7. If any step fails, a compensating action is published (e.g. `PaymentRefunded`, `InventoryReleased`).

```text
Client               Order              Inventory           Payment
  │                    │                    │                  │
  │  POST /order       │                    │                  │
  │───────────────────►│                    │                  │
  │                    │  Create order      │                  │
  │                    │  (pending)         │                  │
  │                    │  Write outbox      │                  │
  │                    │────────┐           │                  │
  │                    │        │ txn       │                  │
  │                    │◄───────┘           │                  │
  │                    │                    │                  │
  │                    │  OrderCreated      │                  │
  │                    │───────────────────►│                  │
  │                    │                    │  Reserve         │
  │                    │                    │  inventory       │
  │                    │                    │────────┐         │
  │                    │                    │        │         │
  │                    │                    │◄───────┘         │
  │                    │  InventoryReserved │                  │
  │                    │─────────────────────────────────────►│
  │                    │                    │                  │
  │                    │                    │            Charge card
  │                    │                    │                  │
  │                    │  PaymentConfirmed  │                  │
  │                    │◄─────────────────────────────────────│
  │                    │                    │                  │
  │                    │  Confirm order     │                  │
  │  Response (201)    │                    │                  │
  │◄───────────────────│                    │                  │
```

---

## Flow: Notification (Event-Driven)

All services publish events through a shared message queue. Notification Service subscribes to multiple events:

```typescript
import { Queue, Worker } from 'bullmq';

const notificationQueue = new Queue('notifications', {
  connection: { host: 'redis://localhost:6379' }
});

// Any service can add a notification
await notificationQueue.add('send-email', {
  to: 'customer@example.com',
  template: 'order-confirmed',
  data: { orderId: 'order-123' }
});

// Worker processes notifications asynchronously
const worker = new Worker('notifications', async (job) => {
  const { to, template, data } = job.data;
  switch (template) {
    case 'order-confirmed':
      await sendEmail(to, `Order ${data.orderId} confirmed!`);
      break;
    case 'payment-failed':
      await sendEmail(to, `Payment failed for ${data.orderId}`);
      break;
  }
});
```

---

## Flow: Read Models (CQRS)

The [CQRS](cqrs.md) pattern separates read and write responsibilities. Analytics Service maintains denormalised read models optimised for queries, decoupled from the transactional write side of the Order and Payment services.

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function onPaymentConfirmed(event: PaymentConfirmedEvent) {
  // Denormalized read model — one query, no joins
  await prisma.orderAnalytics.upsert({
    where: { orderId: event.orderId },
    update: {
      status: 'paid',
      paidAt: new Date(),
      totalRevenue: event.amount
    },
    create: {
      orderId: event.orderId,
      customerId: event.customerId,
      status: 'paid',
      paidAt: new Date(),
      totalRevenue: event.amount
    }
  });
}
```

---

## Resilience Patterns

### Circuit Breaker

Order Service uses a [Circuit Breaker](circuit-breaker.md) to wrap calls to Payment Service, failing fast when it is degraded:

```typescript
import CircuitBreaker from 'opossum';

const paymentBreaker = new CircuitBreaker(chargePayment, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});

paymentBreaker.fallback(() => ({
  status: 'degraded',
  message: 'Payment service unavailable, retrying later'
}));

async function processPayment(orderId: string) {
  const result = await paymentBreaker.fire(orderId);
  if (result.status === 'degraded') {
    // Enqueue for retry via outbox pattern
    await enqueueRetry(orderId);
  }
}
```

### Idempotency

Payment Service uses an [Idempotency](idempotency.md) key to safely handle retries:

```typescript
async function chargeCustomer(
  idempotencyKey: string,
  customerId: string,
  amount: number
) {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.idempotencyKey.findUnique({
      where: { key: idempotencyKey }
    });
    if (existing) return existing.result;

    const charge = await stripe.charges.create({ customerId, amount });
    await tx.idempotencyKey.create({
      data: { key: idempotencyKey, result: charge.id }
    });
    return charge.id;
  });
}
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| HTTP Framework | Express (REST), Apollo Server (GraphQL), gRPC (internal RPC) |
| ORM | Prisma |
| Database | PostgreSQL (per service) |
| Message Queue | BullMQ (Redis) |
| Cache | Redis Cluster (distributed cache) |
| Event Broker | Amazon SNS / SQS |
| API Gateway | Express Gateway or Kong |
| Auth | Keycloak (OIDC + OAuth 2.0 Authorization Code + PKCE, JWT/JWKS validation) |
| Tracing | OpenTelemetry |
| Container | Docker / Kubernetes |

---

## Key Takeaways

> This reference architecture composes [Distributed Systems](distributed-systems.md), [Outbox Pattern](outbox-pattern.md), Saga, CQRS, Event Sourcing, Circuit Breaker, and Idempotency into a cohesive e-commerce platform. Each pattern solves a specific distributed systems challenge — reliable events, transaction coordination, scalable reads, audit trails, and fault tolerance. No single pattern is a silver bullet; the value comes from how they compose.
