# Outbox Pattern

> Ensures reliable message delivery by writing events to a database table within the same transaction as the business operation, then publishing them asynchronously.

---

## What is it?

The Outbox Pattern writes events to an **outbox table** in the same database transaction as the business operation, then a separate process reads and publishes those events to a message broker. This guarantees that either both the business data and the event are persisted, or neither is.

---

## Problem

In distributed systems, services often need to publish events (e.g. `OrderCreated`) after updating their database. Without the outbox pattern, you face the **dual-write problem**:

- If you write to the DB first and then send to the broker, the broker write can fail — the event is lost.
- If you send to the broker first and then write to the DB, the DB write can fail — a phantom event is published.
- Distributed transactions (2PC) add complexity and are often not supported by message brokers.

Without the outbox pattern, you risk data inconsistency between services.

---

## Example

In SQL, the outbox write happens in the same transaction as the business data:

```sql
BEGIN;

INSERT INTO orders (id, customer_id, total, status)
VALUES ('order-123', 'cust-456', 99.99, 'confirmed');

INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload, created_at)
VALUES (
  gen_random_uuid(),
  'order',
  'order-123',
  'OrderCreated',
  '{"order_id": "order-123", "total": 99.99}',
  now()
);

COMMIT;
```

In Node.js with Prisma, `$transaction` achieves the same atomicity:

```typescript
import { PrismaClient } from '@prisma/client';
import { SQS } from 'aws-sdk';

const prisma = new PrismaClient();
const sqs = new SQS();

async function createOrder(customerId: string, total: number) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { customerId, total, status: 'confirmed' }
    });

    await tx.outbox.create({
      data: {
        aggregateType: 'order',
        aggregateId: order.id,
        eventType: 'OrderCreated',
        payload: { orderId: order.id, total }
      }
    });
  });
}

async function pollOutbox() {
  const events = await prisma.outbox.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 10
  });

  for (const event of events) {
    await sqs
      .sendMessage({
        QueueUrl: process.env.QUEUE_URL!,
        MessageBody: JSON.stringify(event.payload)
      })
      .promise();

    await prisma.outbox.update({
      where: { id: event.id },
      data: { processedAt: new Date() }
    });
  }
}
```

---

## Architecture / Flow

```text
Service A
    │
    ├── 1. Write business data + outbox event (same DB transaction)
    │
    ▼
Database
    │
    │  outbox table ───► 2. Publisher polls unprocessed rows
    │                            │
    │                            ▼
    │                    Message Broker (SQS / Kafka)
    │                            │
    ▼                            ▼
Service B              Service C (consume events)
```

Two common publisher implementations:

| Approach | Description |
|----------|-------------|
| **Polling Publisher** | Background process queries the outbox table on a schedule, publishes new events, then marks them as sent |
| **CDC (Change Data Capture)** | Tools like Debezium read the database transaction log and forward outbox inserts directly to the broker |

---

## How it Works

1. Service receives a request and begins a database transaction.
2. Within the same transaction, it inserts business data (e.g. order) and an event record into the `outbox` table.
3. The transaction commits — both the business data and the event are persisted together.
4. A publisher process polls the `outbox` table for unprocessed events (or CDC captures them from the WAL).
5. The publisher sends the event to the message broker.
6. On successful delivery acknowledgment, the publisher marks the outbox record as processed (or deletes it).
7. Downstream services consume the event from the broker.
8. If publishing fails, the event remains in the outbox table and is retried on the next poll cycle.

---

## Advantages

- **Atomicity** — business data and event are persisted together via a single database transaction
- **Reliable delivery** — events are not lost even if the broker is temporarily unavailable
- **Ordering** — events can be ordered by primary key or timestamp in the outbox table
- **Idempotent retries** — unprocessed events are retried automatically
- **No distributed transaction** — avoids 2PC complexity
- **Audit trail** — the outbox table acts as a record of all published events

---

## Trade-offs

- **Storage overhead** — outbox table grows and needs cleanup (archival or deletion of processed rows)
- **At-least-once delivery** — consumers must handle duplicate events (idempotency)
- **Publishing latency** — events are not real-time; delay depends on poll interval or CDC lag
- **Operational complexity** — requires running a publisher or CDC infrastructure
- **Polling overhead** — polling queries can become expensive at scale without proper indexing

---

## When to Use

- Services that must publish events and cannot tolerate message loss
- Event-driven architectures where strong consistency between DB state and events matters
- Migrating from a monolith to microservices with reliable event communication
- Systems already using a relational database (PostgreSQL, MySQL, etc.)

---

## When NOT to Use

- Simple, synchronous workflows where dual-write risk is acceptable
- Systems that already use a message broker as the source of truth and can tolerate eventual consistency
- When the operational cost of running a publisher or CDC pipeline outweighs the benefit
- Applications that do not need event-driven communication

---

## Related Concepts

- Dual-Write Problem
- CDC (Change Data Capture)
- Event-Driven Architecture
- Saga Pattern
- [CQRS](cqrs.md)
- Message Queue
- Idempotency
- Event Sourcing
- [Distributed Systems](distributed-systems.md)

---

## Key Takeaways

> The Outbox Pattern solves the dual-write problem by persisting business data and events in the same database transaction, then publishing events asynchronously. It guarantees at-least-once delivery without distributed transactions, at the cost of storage overhead and publishing latency. Consumers must handle duplicates via idempotency.
