# Express + Prisma + BullMQ: Outbox, Idempotency & Retry

A focused demo combining three resilience patterns with HTTP-layer idempotency into a single end-to-end flow, using Express 5, Prisma 7, and BullMQ.

## Patterns Demonstrated

| Pattern | Where | What It Does |
|---------|-------|-------------|
| **Outbox Pattern** | `routes/orders.ts` + `services/outboxPoller.ts` | Writes event to outbox table in same transaction as business data. A poller publishes to BullMQ. No dual-write risk. |
| **Message Idempotency** | `services/orderProcessor.ts` | Consumer checks `ProcessedMessage` table by jobId before processing. Duplicates are silently skipped. |
| **HTTP Idempotency** | `routes/orders.ts` | Client sends `Idempotency-Key` header; server caches the response and deduplicates identical requests. Combined with a SHA-256 body hash to detect key reuse with a different payload. |
| **Retry Pattern** | `queue.ts` | BullMQ retries failed jobs with exponential backoff (3 attempts, 2s initial delay). |
| **Graceful Shutdown** | `index.ts` | SIGINT/SIGTERM stops the poller, drains the worker, closes DB connection. |

## Flow

```
POST /orders (Idempotency-Key?, {customerId, total, items})
         │
         ▼
  ┌────────────────────────────────┐
  │  Idempotency-Key present?      │
  │  ├─ Yes → Look up key          │
  │  │   ├─ Found + same hash → 201│  ← Cached response
  │  │   ├─ Found + diff hash → 409│  ← Conflict
  │  │   └─ Not found → continue   │
  │  └─ No → continue              │
  └──────────┬─────────────────────┘
             ▼
  ┌─────────────────────────┐
  │  Prisma $transaction    │  ← Outbox Pattern
  │  1. Create order        │     (atomic write)
  │  2. Insert outbox_event │
  │  3. Record idempotency  │
  │     key + body hash     │
  └─────────┬───────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │  Outbox Poller          │  ← Polls every 2s
  │  Reads unprocessed      │     Publish to BullMQ
  │  events → queue.add()   │     Mark event processed
  └─────────┬───────────────┘
             │
             ▼
  ┌─────────────────────────┐
  │  BullMQ Worker          │  ← Retry Pattern
  │  Checks idempotency key │     (exponential backoff)
  │  Skips if already done  │
  │  Updates order status   │  ← Message Idempotency
  │  to "confirmed"         │     (dedup table)
  └─────────────────────────┘
```

## Setup

### Prerequisites

- Docker (for PostgreSQL and Redis)
- pnpm

### Run

```bash
# 1. Start PostgreSQL and Redis
docker compose up -d

# 2. Install dependencies
pnpm install

# 3. Run database migrations
pnpm db:migrate

# 4. Start the server (auto-restarts on file changes)
pnpm dev
```

### Test

```bash
# Create an order — triggers the full outbox → queue → idempotent worker flow
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerId": "usr_123", "total": 49.99, "items": [{"productId": "prod_1", "quantity": 2}]}'

# Verify the order was created and processed
psql postgresql://app:app@localhost:5433/express_resilience -c "SELECT id, status FROM \"Order\";"
psql postgresql://app:app@localhost:5433/express_resilience -c "SELECT * FROM \"OutboxEvent\";"
psql postgresql://app:app@localhost:5433/express_resilience -c "SELECT * FROM \"ProcessedMessage\";"
```

### Test HTTP Idempotency (Idempotency-Key)

Client retries with the same key — first call creates, second returns cached:

```bash
# First request (creates the order)
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-unique-key-001' \
  -d '{"customerId": "usr_idem", "total": 79.99, "items": [{"productId": "prod_y", "quantity": 1}]}'

# Retry — same key, same body → 201 with cached response (no order created)
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-unique-key-001' \
  -d '{"customerId": "usr_idem", "total": 79.99, "items": [{"productId": "prod_y", "quantity": 1}]}'

# Different body with the same key → 409 Conflict
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-unique-key-001' \
  -d '{"customerId": "usr_other", "total": 99.99, "items": [{"productId": "prod_z", "quantity": 2}]}'
```

### Test Message Idempotency

Duplicate delivery — same BullMQ `jobId` will be skipped:

```bash
# The outbox poller uses event.id as jobId.
# Even if BullMQ delivers the same message twice, the second attempt
# finds the idempotency key in ProcessedMessage and skips processing.
```

### Test Retry

Stop the worker mid-processing (Ctrl+C), send a request, restart — the job retries via BullMQ's exponential backoff.

Or use the built-in `?fail=true` flag — sends an order whose outbox event triggers a simulated failure in the consumer:

```bash
curl -X POST 'http://localhost:4000/api/orders?fail=true' \
  -H 'Content-Type: application/json' \
  -d '{"customerId": "usr_retry", "total": 99.99, "items": [{"productId": "prod_x", "quantity": 1}]}'
```

The worker logs show 3 failed attempts (2s, 4s, 8s) before the job is permanently marked as failed.

## Project Structure

```
src/
├── index.ts                  # Express server, graceful shutdown
├── db.ts                     # Prisma client
├── queue.ts                  # BullMQ queue + worker factory
├── workers.ts                # Worker setup with start/stop
├── routes/
│   └── orders.ts             # POST /orders — idempotency check + outbox transaction
└── services/
    ├── outboxPoller.ts       # Reads outbox → publishes to queue
    └── orderProcessor.ts     # Idempotent consumer handler
prisma/
└── schema.prisma             # Order, OutboxEvent, ProcessedMessage, IdempotencyRequest
```

## Related Docs

- [Outbox Pattern](/docs/outbox-pattern.md)
- [Idempotency](/docs/idempotency.md)
- [Retry Pattern](/docs/retry-pattern.md)
- [Graceful Shutdown](/docs/graceful-shutdown.md)
- [Connection Pooling](/docs/connection-pooling.md)
