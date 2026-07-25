# Express + Prisma + BullMQ: Outbox, Idempotency & Retry

A focused demo combining three resilience patterns into a single end-to-end flow, using the latest Express 5, Prisma 7, and BullMQ.

## Patterns Demonstrated

| Pattern | Where | What It Does |
|---------|-------|-------------|
| **Outbox Pattern** | `routes/orders.ts` + `services/outboxPoller.ts` | Writes event to outbox table in same transaction as business data. A poller publishes to BullMQ. No dual-write risk. |
| **Idempotency** | `services/orderProcessor.ts` | Consumer checks `ProcessedMessage` table by idempotency key before processing. Duplicates are silently skipped. |
| **Retry Pattern** | `queue.ts` | BullMQ retries failed jobs with exponential backoff (3 attempts, 2s initial delay). |
| **Graceful Shutdown** | `index.ts` | SIGINT/SIGTERM stops the poller, drains the worker, closes DB connection. |

## Flow

```
POST /orders (customerId, total, items)
        │
        ▼
  ┌─────────────────────────┐
  │  Prisma $transaction    │  ← Outbox Pattern
  │  1. Create order        │     (atomic write)
  │  2. Insert outbox_event │
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
  │  Updates order status   │  ← Idempotency
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
# Create an order — this triggers the full outbox → queue → idempotent worker flow
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerId": "usr_123", "total": 49.99, "items": [{"productId": "prod_1", "quantity": 2}]}'

# Verify the order was created and processed
psql postgresql://app:app@localhost:5433/express_resilience -c "SELECT id, status FROM \"Order\";"
psql postgresql://app:app@localhost:5433/express_resilience -c "SELECT * FROM \"OutboxEvent\";"
psql postgresql://app:app@localhost:5433/express_resilience -c "SELECT * FROM \"ProcessedMessage\";"
```

### Test Idempotency

Duplicate delivery — same BullMQ `jobId` will be skipped:

```bash
# The outbox poller uses event.id as jobId.
# Even if BullMQ delivers the same message twice, the second attempt
# finds the idempotency key in ProcessedMessage and skips processing.
```

### Test Retry

Stop the worker mid-processing (Ctrl+C), send a request, restart — the job retries via BullMQ's exponential backoff.

## Project Structure

```
src/
├── index.ts                  # Express server, graceful shutdown
├── db.ts                     # Prisma client
├── queue.ts                  # BullMQ queue + worker factory
├── workers.ts                # Worker setup with start/stop
├── routes/
│   └── orders.ts             # POST /orders — outbox transaction
└── services/
    ├── outboxPoller.ts       # Reads outbox → publishes to queue
    └── orderProcessor.ts     # Idempotent consumer handler
prisma/
└── schema.prisma             # Order, OutboxEvent, ProcessedMessage
```

## Related Docs

- [Outbox Pattern](/docs/outbox-pattern.md)
- [Idempotency](/docs/idempotency.md)
- [Retry Pattern](/docs/retry-pattern.md)
- [Graceful Shutdown](/docs/graceful-shutdown.md)
- [Connection Pooling](/docs/connection-pooling.md)
