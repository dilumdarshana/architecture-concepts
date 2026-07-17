# Claim-Check Pattern

> Using row-level locks to claim a message for processing, ensuring that only one consumer processes it even when multiple consumers compete.

---

## What is it?

The **Claim-Check Pattern** (also known as pessimistic concurrency on a message table) prevents duplicate processing when multiple consumers poll the same database-backed queue. Each consumer attempts to claim a message by updating its status with `SELECT ... FOR UPDATE` — the database guarantees that only one consumer succeeds. The others see the claimed status and skip to the next message.

This pattern fills the gap between idempotency (detects duplicates after processing) and distributed locks (prevents concurrent access) — it prevents concurrent processing at the claim step, before any business logic runs.

---

## Problem

In a database-backed queue or when multiple consumers poll the same table for work:

- Two consumers run `SELECT * FROM messages WHERE status = 'pending'` at the same time — both get the same message.
- Both consumers start processing it simultaneously.
- Both update inventory, charge the customer, or send an email — duplicate side effects.
- Idempotency can detect the duplicate after processing, but the damage (e.g. two emails sent) is already done for operations with irreversible side effects.
- A distributed lock prevents the concurrent processing but adds a separate infrastructure dependency (Redis) and its own failure modes (lock expiry, network partition).

The claim-check pattern uses the database's built-in pessimistic locking to claim a row atomically — no separate lock service required.

---

## Example

### Claiming a Message with SELECT FOR UPDATE

```typescript
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function pollAndProcess() {
  while (true) {
    const message = await claimNextMessage();
    if (!message) {
      await sleep(1000);
      continue;
    }

    try {
      await processMessage(message);
      await markCompleted(message.id);
    } catch (err) {
      await markFailed(message.id, err);
    }
  }
}

async function claimNextMessage(): Promise<Message | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Claim: atomically select and lock the next pending message
    const result = await client.query(
      `SELECT id, payload
       FROM messages
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (result.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const message = result.rows[0];

    // Mark as claimed so other consumers skip it on subsequent polls
    await client.query(
      `UPDATE messages SET status = 'claimed', claimed_at = NOW(), claimed_by = $1
       WHERE id = $2`,
      [process.env.HOSTNAME, message.id]
    );

    await client.query('COMMIT');
    return message;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

### With Prisma

Using Prisma's `$queryRawUnsafe` for the lock, then a regular update:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function claimNextMessage(): Promise<Message | null> {
  return prisma.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE SKIP LOCKED within the transaction
    const messages: Message[] = await tx.$queryRawUnsafe(
      `SELECT id, payload
       FROM messages
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (messages.length === 0) return null;

    const message = messages[0];

    await tx.message.update({
      where: { id: message.id },
      data: { status: 'claimed', claimedAt: new Date() }
    });

    return message;
  });
}
```

### Processing and Completing

Once claimed, the consumer processes and marks as completed. If it crashes, a separate recovery job reassigns expired claims:

```typescript
async function processMessage(message: Message) {
  // Business logic — idempotency still matters here
  await prisma.$transaction(async (tx) => {
    // Use the outbox pattern to publish follow-up events
    await tx.order.update({ where: { id: message.orderId }, data: { status: 'confirmed' } });
    await tx.outbox.create({
      data: {
        aggregateType: 'order',
        aggregateId: message.orderId,
        eventType: 'OrderConfirmed',
        payload: { orderId: message.orderId }
      }
    });
  });

  // Mark as completed (or delete)
  await prisma.message.update({
    where: { id: message.id },
    data: { status: 'completed', completedAt: new Date() }
  });
}
```

### Recovery Job — Reassign Expired Claims

If a consumer crashes after claiming but before completing, the message remains in `claimed` status. A recovery job reassigns it:

```typescript
async function recoverStaleClaims() {
  await prisma.$transaction(async (tx) => {
    const stale = await tx.$queryRawUnsafe(
      `SELECT id FROM messages
       WHERE status = 'claimed'
       AND claimed_at < NOW() - INTERVAL '5 minutes'
       FOR UPDATE SKIP LOCKED`
    );

    for (const message of stale) {
      await tx.message.update({
        where: { id: message.id },
        data: {
          status: 'pending',
          claimedAt: null,
          claimedBy: null,
          retryCount: { increment: 1 }
        }
      });
    }
  });
}
```

---

## Architecture / Flow

```text
Consumer A                    Database (messages table)              Consumer B
    │                                │                                  │
    │  BEGIN                         │                                  │
    │  SELECT ... FOR UPDATE         │                                  │
    │  SKIP LOCKED                   │                                  │
    │──────────────────────────────►│                                  │
    │                                │  Lock row 1 (exclusive)          │
    │◄──────────────────────────────│  Row 1 returned                  │
    │                                │                                  │
    │  UPDATE status='claimed'       │                                  │
    │──────────────────────────────►│                                  │
    │  COMMIT                        │                                  │
    │                                │                                  │
    │                                │         BEGIN                    │
    │                                │         SELECT ... FOR UPDATE    │
    │                                │         SKIP LOCKED              │
    │                                │◄─────────────────────────────────│
    │                                │                                  │
    │                                │  Row 1 is locked → skip          │
    │                                │  Row 2 is free → return row 2    │
    │                                │─────────────────────────────────►│
    │                                │         Row 2 claimed            │
    │                                │                                  │
    │  Process row 1                 │         Process row 2            │
    │  (exclusive)                   │         (exclusive)              │
```

---

## How it Works

1. Each consumer polls for work by beginning a transaction and running `SELECT ... FOR UPDATE SKIP LOCKED`.
2. `FOR UPDATE` locks the selected rows exclusively. `SKIP LOCKED` tells the database to skip rows already locked by another transaction — consumers never block waiting for each other.
3. The consumer updates the message status from `pending` to `claimed`, recording who claimed it and when.
4. The transaction commits, releasing the lock.
5. The consumer processes the message (business logic, outbox events, etc.).
6. On success, the consumer updates the status to `completed` (or deletes the row).
7. On failure, the consumer updates the status to `failed` with an error message and retry count.
8. If the consumer crashes during processing, the message remains `claimed`. A separate recovery job queries for stale claims where `claimed_at` exceeds a timeout and resets them to `pending`.

---

## Advantages

- **No external lock service** — uses the database's built-in row-level locking; no Redis, no Redlock complexity
- **SKIP LOCKED** — consumers never block each other; each picks up the next available unclaimed row
- **Atomic claim** — the `SELECT ... FOR UPDATE` and status update are in the same transaction; no race window
- **Crash recovery** — stale claims are reassigned by a recovery job with a simple timeout query
- **Ordered processing** — `ORDER BY created_at ASC` ensures FIFO processing order, unlike message brokers that may reorder on redelivery

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Database load** — polling queries consume database resources even when the queue is empty | Use a backoff or notify mechanism to reduce idle polling (e.g. `LISTEN`/`NOTIFY` in PostgreSQL) |
| **Lock duration** — the lock is held for the duration of the claim transaction (not the full processing) | The claim step is fast (milliseconds); the actual processing happens after the transaction commits and the lock is released |
| **Recovery window** — crashed consumers leave stale claims until the recovery job runs | Recovery interval must balance quick recovery against giving the original consumer enough time to finish |
| **Retry handling** — without careful design, the recovery job can keep reassigning the same failing message | Track retry count and move to a dead-letter queue after a threshold |
| **Not for cross-service queues** — each service must share the same database to use this pattern | For cross-service queues, use a message broker (SQS, Kafka) with its own delivery semantics |

---

## When to Use

- Database-backed queues where multiple consumers poll the same table
- Systems where the database is already the source of truth — avoids introducing a separate lock service
- Workloads that need ordered processing within the same consumer pool
- Scenarios where a message broker is overkill and a database table is sufficient (small to medium throughput)

---

## When NOT to Use

- High-throughput systems where database polling becomes a bottleneck (use a dedicated message broker like Kafka or SQS instead)
- Cross-service queues where consumers do not share a database
- Systems that already use Redis or ZooKeeper for distributed locking — the claim-check pattern duplicates that infrastructure
- Operations where the cost of occasional duplicates is acceptable and the complexity of claim-check recovery is not justified

---

## Related Concepts

- [Database Concurrency Control](database-concurrency-control.md) — `SELECT ... FOR UPDATE` and row-level locking are the foundation of the claim-check pattern
- [Idempotency](idempotency.md) — claim-check prevents concurrent processing; idempotency detects and handles any remaining duplicates
- [Distributed Lock](distributed-lock.md) — an alternative approach using an external lock service instead of database row locking
- [Outbox Pattern](outbox-pattern.md) — once a message is claimed and processed, outbound events are published via the outbox
- [Delivery Semantics](delivery-semantics.md) — claim-check provides at-least-once delivery with ordered processing
- [Graceful Shutdown](graceful-shutdown.md) — during shutdown, consumers should release their claims gracefully instead of relying on the recovery timeout
- SKIP LOCKED

---

## Key Takeaways

> The Claim-Check Pattern uses `SELECT ... FOR UPDATE SKIP LOCKED` across consumer database transactions to intercept and claim unique messages as they are popped from a shared table, guaranteeing that only one consumer processes each message. It provides ordered, at-least-once processing without an external lock service, but requires a recovery job to reassign stale claims from crashed consumers.
