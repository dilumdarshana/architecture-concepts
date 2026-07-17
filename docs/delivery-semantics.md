# Delivery Semantics

> The guarantee a system provides about whether a message or operation will be delivered and processed — classified as at-most-once, at-least-once, or exactly-once.

---

## What is it?

**Delivery semantics** define how many times a message or operation is processed in the presence of failures. The three levels form a trade-off between reliability, complexity, and throughput:

| Semantic | Guarantee | Duplicates Allowed? | Misses Allowed? |
|----------|-----------|---------------------|-----------------|
| **At-most-once** | Delivered 0 or 1 times | No | Yes |
| **At-least-once** | Delivered 1 or more times | Yes | No |
| **Exactly-once** | Delivered exactly 1 time | No | No |

No distributed system can guarantee exactly-once at the transport layer alone — it is always achieved by combining **at-least-once delivery** with [Idempotency](idempotency.md) at the consumer.

---

## Problem

In a [Distributed System](distributed-systems.md), messages travel over a network that can fail at any point:

- The producer sends a message but the broker never receives it.
- The broker receives and stores the message, but the acknowledgment is lost before reaching the producer.
- The consumer receives the message, processes it, but crashes before acknowledging it.
- The consumer processes the message and acknowledges it, but the broker does not receive the acknowledgment.

Without explicit delivery semantics, the system cannot make consistent guarantees — duplicates and missed messages are unpredictable.

---

## Example

### At-Most-Once (Fire and Forget)

The producer sends once and does not retry. If the message is lost, it is never processed.

```typescript
// Producer: send with no retry
import { SQS } from 'aws-sdk';

const sqs = new SQS();

// No retries, no acknowledgment tracking — at-most-once
await sqs
  .sendMessage({
    QueueUrl: process.env.QUEUE_URL!,
    MessageBody: JSON.stringify(event)
  })
  .promise()
  .catch(() => {}); // silently ignore failures
```

```typescript
// Consumer: process and delete immediately
import { Consumer } from 'sqs-consumer';

const consumer = Consumer.create({
  queueUrl: process.env.QUEUE_URL!,
  handleMessage: async (message) => {
    // If this throws, the message is still lost (no retry queue)
    await processEvent(JSON.parse(message.Body!));
  }
});
```

### At-Least-Once (Retry on Failure)

The producer retries on failure, and the consumer acknowledges only after successful processing. Duplicates are possible but no message is lost.

```typescript
// Producer: retry with exponential backoff
import { SQS } from 'aws-sdk';

const sqs = new SQS();

async function sendWithRetry(message: object, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await sqs.sendMessage({
        QueueUrl: process.env.QUEUE_URL!,
        MessageBody: JSON.stringify(message)
      }).promise();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * Math.pow(2, attempt)); // backoff
    }
  }
}
```

```typescript
// Consumer: acknowledge only after processing
const consumer = Consumer.create({
  queueUrl: process.env.QUEUE_URL!,
  handleMessage: async (message) => {
    await processEvent(JSON.parse(message.Body!));
    // If processEvent throws, the message becomes visible again
    // after the visibility timeout — at-least-once semantics
  }
});
```

### Exactly-Once (At-Least-Once + Idempotency)

The system uses at-least-once delivery plus an [Idempotency](idempotency.md) key on the consumer to discard duplicates.

```typescript
// Consumer: deduplicate using idempotency key
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function handleMessage(message: Message) {
  const { idempotencyKey, payload } = JSON.parse(message.Body!);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.processedMessage.findUnique({
      where: { idempotencyKey }
    });

    if (existing) {
      // Duplicate — discard
      return;
    }

    await processEvent(payload);

    await tx.processedMessage.create({
      data: { idempotencyKey, processedAt: new Date() }
    });
  });
}
```

---

## Architecture / Flow

```text
Producers                             Message Queue                     Consumer
    │                                      │                              │
    │  At-Most-Once                        │                              │
    │  ───────────                         │                              │
    │  Send message ──────────────────────►│  Deliver ───────────────────►│
    │  (no retry)                ── lost ──►  (if ack lost,               │
    │                                      │   message is gone)           │
    │                                      │                              │
    │  At-Least-Once                       │                              │
    │  ────────────                        │                              │
    │  Send message ──────────────────────►│  Deliver ───────────────────►│
    │  │   (retry on ack loss)             │  │  Process                   │
    │  │   ───► Send again ───────────────►│  │  Ack                       │
    │  │   (duplicate possible)            │  │  ◄────────────────────────│
    │  │                                   │  │  (if ack lost,             │
    │  │                                   │  │   message is redelivered)  │
    │                                      │                              │
    │  Exactly-Once                        │                              │
    │  ───────────                         │                              │
    │  Send message ──────────────────────►│  Deliver ───────────────────►│
    │  │   (at-least-once delivery)        │  │  1. Check idempotency key  │
    │  │                                   │  │  2. If duplicate → discard │
    │  │                                   │  │  3. If new → process       │
    │  │                                   │  │  4. Store idempotency key  │
    │  │                                   │  │  5. Ack                     │
```

---

## How it Works

1. **Producer** sends a message to the broker (queue, topic, stream).
2. **Broker** receives the message and stores it durably.
3. **Broker** delivers the message to a consumer.
4. **Consumer** processes the message and sends an acknowledgment.
5. **At-most-once**: if the producer or broker fails between steps 1-3, the message is lost. No retry.
6. **At-least-once**: if any acknowledgment is lost (step 4-5), the producer retries (step 1) or the broker redelivers (step 3). The message may be processed multiple times.
7. **Exactly-once**: the consumer tracks processed message IDs (idempotency keys). Duplicate deliveries are detected and silently discarded, making the observable result exactly-once.

---

## Advantages

| Semantic | Advantages |
|----------|------------|
| **At-most-once** | Lowest latency; no retry overhead; no duplicate handling |
| **At-least-once** | Reliable — no messages lost; simple retry logic; supported by all message brokers natively |
| **Exactly-once** | Correctness guarantee — duplicates are impossible at the application level |

---

## Trade-offs

| Semantic | Trade-offs |
|----------|------------|
| **At-most-once** | Messages can be silently lost; unsuitable for payments, orders, or any critical operation |
| **At-least-once** | Duplicates are possible; consumers must tolerate or handle them; higher latency from retries |
| **Exactly-once** | Requires idempotency storage (extra DB write per message); higher latency; no true transport-level exactly-once — always at-least-once + deduplication |

---

## When to Use

| Semantic | When to Use |
|----------|-------------|
| **At-most-once** | Metrics, logs, telemetry — where losing a sample is acceptable |
| **At-least-once** | Most business events — order creation, payment processing, inventory updates where no message can be lost |
| **Exactly-once** | Financial transactions, ledger entries, operations where duplicates cause data corruption |

---

## When NOT to Use

- **At-most-once** — never use for payments, orders, or any operation with side effects.
- **At-least-once** — avoid when the consumer cannot handle duplicates (e.g. appending to a log without deduplication).
- **Exactly-once** — avoid when the cost of idempotency storage outweighs the risk of duplicates (e.g. high-throughput metrics with rare duplicates).

---

## Related Concepts

- [Idempotency](idempotency.md) — the mechanism that upgrades at-least-once to exactly-once
- [Outbox Pattern](outbox-pattern.md) — provides at-least-once event delivery from the producer side
- [Distributed Systems](distributed-systems.md) — delivery semantics are a fundamental trade-off in networked systems
- [Saga Pattern](saga-pattern.md) — each step must use at-least-once delivery with idempotent handlers
- Message Queue
- Retry Pattern
- Dead Letter Queue

---

## Key Takeaways

> No transport guarantees exactly-once delivery — it is always at-least-once plus idempotency on the consumer. At-most-once is fastest but loses messages. At-least-once is reliable but produces duplicates. Exactly-once adds idempotency storage to strip duplicates, providing application-level correctness. Choose based on how costly duplicates are versus how costly missed messages are.
