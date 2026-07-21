# Message Queues

> A durable communication channel that decouples producers from consumers by storing and routing messages asynchronously.

---

## What is it?

A message queue is a middleware component that accepts messages from producers, stores them durably, and delivers them to consumers. Producers send messages without waiting for consumers to process them; consumers receive messages without knowing who produced them. This decoupling enables asynchronous communication, load leveling, fault isolation, and scalable processing. The major message broker families are **Kafka** (log-based, partitioned, ordered), **RabbitMQ** (AMQP, exchange-based routing), **Amazon SQS** (fully managed, at-least-once), and **Redis Streams** / **BullMQ** (lightweight, Redis-backed).

---

## Problem

In a distributed system, services must communicate without blocking each other:

- **Synchronous coupling** — Service A calls Service B directly. If B is slow or down, A is blocked.
- **Traffic spikes** — A flash sale produces 10k orders/second. The notification service can only send 100 emails/second. Without a queue, emails are lost or the notification service is overwhelmed.
- **Lost messages** — A publishes an event that B should process. If B is restarting during publication, the event is lost.
- **Multiple consumers** — A single event (e.g. `OrderPlaced`) should be processed by the notification service, analytics service, and inventory service independently.

---

## Example

### Without a Queue

```typescript
// Synchronous: Order Service directly calls Notification Service
async function placeOrder(data: OrderInput) {
  const order = await db.orders.create(data);
  await notificationService.sendEmail(order); // blocks if notification is slow
  await analyticsService.track(order);        // blocks if analytics is down
  return order;
}
```

### With a Queue (BullMQ / Redis)

```typescript
import { Queue, Worker } from 'bullmq';

// Producer — Order Service
const orderQueue = new Queue('orders', {
  connection: { host: 'redis://localhost:6379' }
});

async function placeOrder(data: OrderInput) {
  const order = await db.orders.create(data);
  await orderQueue.add('order-placed', order, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
  return order;
}

// Consumer — Notification Service
const worker = new Worker('orders', async (job) => {
  switch (job.name) {
    case 'order-placed':
      await sendEmail(job.data.customerEmail, 'Your order is confirmed!');
      break;
  }
}, { concurrency: 5 });

// Consumer — Analytics Service (same queue, different worker group)
const analyticsWorker = new Worker('orders', async (job) => {
  await analytics.track('order_placed', {
    orderId: job.data.id,
    total: job.data.total
  });
}, { concurrency: 10 });
```

---

## Architecture / Flow

### Broker Comparison

| Feature | Kafka | RabbitMQ | Amazon SQS | Redis Streams / BullMQ |
|---------|-------|----------|------------|----------------------|
| **Model** | Log-based, partitioned | Exchange + queue | Fully managed FIFO or standard | Stream/list-based |
| **Ordering** | Per-partition (strong within partition) | Per-queue (single consumer) | FIFO queue (limited throughput) | Per-stream group |
| **Delivery** | At-least-once, exactly-once (with idempotent producer) | At-most-once, at-least-once | At-least-once, exactly-once (FIFO) | At-least-once |
| **Retention** | Configurable (days/weeks) | Deleted after ack | 4-14 days | Configurable |
| **Replay** | Yes (rewind consumer offset) | No (acknowledged messages are deleted) | No (deleted after ack) | Yes (reclaim pending entries) |
| **Throughput** | Millions/sec (partitioned) | Thousands/sec | Thousands/sec (standard), hundreds (FIFO) | Thousands/sec |
| **Consumer model** | Consumer groups (partition-based) | Competing consumers, pub/sub | Pull-based, concurrent consumers | Consumer groups |
| **Node.js client** | `kafkajs` | `amqplib` | `@aws-sdk/client-sqs` | `bullmq` |

### Queue Topologies

```text
Direct Exchange (RabbitMQ)
  ┌──────────┐     routing_key      ┌──────────┐
  │ Producer  │ ── "order.created" ─►│ Queue A  │ ──► Consumer A
  └──────────┘                       └──────────┘

  Message routed to queue whose binding key matches exactly.

Topic Exchange (RabbitMQ)
  ┌──────────┐                      ┌──────────┐
  │          │ ── "order.*" ──────►│ Queue A  │ ──► Order notifications
  │ Producer │                      └──────────┘
  │          │                      ┌──────────┐
  │          │ ── "#.analytics" ──►│ Queue B  │ ──► Analytics pipeline
  └──────────┘                      └──────────┘
  Message routed by pattern matching (wildcards: * matches one word, # matches zero or more).

Fanout Exchange (RabbitMQ)
  ┌──────────┐
  │          │ ──────────────► Queue A ──► Notification Service
  │ Producer │ ──────────────► Queue B ──► Analytics Service
  │          │ ──────────────► Queue C ──► Search Indexer
  └──────────┘
  Message broadcast to every bound queue — each consumer gets a copy.

Kafka Topics and Partitions
  ┌──────────┐    Topic: "orders" (3 partitions)
  │ Producer  │    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ (key:     │───►│Partition 0│───►│Partition 1│───►│Partition 2│
  │  user_id) │    └────┬─────┘    └────┬─────┘    └────┬─────┘
  └──────────┘         │               │               │
                   Consumer           Consumer       Consumer
                   Group A           Group A         Group A
                   (owns 0,1)        (owns 0,1)     (owns 2)

  Each partition is ordered. Keys with the same hash go to the same partition.
  Consumer groups split partition ownership across members.
```

---

## How it Works

### Kafka

1. A **topic** is created with a configurable number of **partitions** (e.g. 3 partitions).
2. The producer sends a message with a key — the key is hashed to determine which partition the message lands in.
3. Messages within a partition are strictly ordered and assigned an **offset** (sequential ID).
4. Kafka persists messages to disk for a configurable retention period (e.g. 7 days).
5. A **consumer group** subscribes to the topic. Each partition is assigned to one consumer in the group.
6. The consumer reads messages sequentially by offset and commits its progress.
7. If the consumer crashes, the partition is reassigned to another consumer in the group, which resumes from the last committed offset.
8. Multiple consumer groups can read the same topic independently — each group gets every message.

### RabbitMQ

1. A **producer** sends a message to an **exchange** with a **routing key**.
2. The exchange type (direct, topic, fanout, headers) determines how the message is routed.
3. The exchange routes the message to **queues** that are bound with matching **binding keys**.
4. Each queue delivers messages to its consumers — either by pushing (basic.consume) or by the consumer pulling (basic.get).
5. The consumer sends an **acknowledgment** after processing. If the consumer disconnects without acking, the message is requeued.
6. Messages without a consumer (and no dead-letter config) are dropped if the queue has a TTL or max length.

### Amazon SQS

1. A producer sends a message to an SQS queue (standard or FIFO).
2. SQS persists the message across multiple availability zones.
3. Consumers poll the queue (long polling: `WaitTimeSeconds=20`) to receive messages.
4. Each message is locked with a **visibility timeout** — other consumers cannot see it during this window.
5. After processing, the consumer deletes the message. If it does not delete before the visibility timeout expires, the message becomes visible again (at-least-once delivery).
6. Standard queues may deliver messages out of order or multiple times. FIFO queues guarantee order and exactly-once within a message group.

### Redis Streams / BullMQ

1. A producer adds a message to a **stream** (BullMQ manages this via `Queue.add`).
2. The stream stores messages as entries with sequential IDs.
3. Consumer groups divide the stream — each group has its own cursor.
4. Each consumer in a group claims pending entries using `XREADGROUP`.
5. After processing, the consumer acknowledges the entry with `XACK`.
6. BullMQ wraps this with retries, backoff, scheduling, and job lifecycle events.

---

## Key Design Decisions

### At-Least-Once vs Exactly-Once

```text
At-least-once:
  Producer ──► Queue ──► Consumer
                             │
                         Process ✓
                             │
                         Ack fails (network blip)
                             │
  Producer ──► Queue ──► Consumer (delivered again!)
                             │
                         Process again (must be idempotent)

Exactly-once = at-least-once + idempotent consumer
```

See [Delivery Semantics](delivery-semantics.md) and [Idempotency](idempotency.md).

### Message Ordering

| Scenario | Ordering Guarantee | Limitation |
|----------|-------------------|------------|
| SQS Standard | No ordering | High throughput |
| SQS FIFO | Strict ordering per message group | 300 TPS |
| Kafka | Strict ordering per partition | Order across partitions not guaranteed |
| RabbitMQ | Strict ordering per queue with single consumer | Multiple consumers break ordering |
| BullMQ | FIFO within queue | Delayed jobs may reorder |

### Dead-Letter Queue (DLQ)

Messages that cannot be processed after exhausting retries are moved to a dead-letter queue:

```typescript
import { Queue, Worker } from 'bullmq';

const mainQueue = new Queue('payments', {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnFail: false // keep failed jobs
  }
});

const dlq = new Queue('payments-dlq');

const worker = new Worker('payments', async (job) => {
  const result = await chargeStripe(job.data);
  return result;
});

// After all retries exhausted, move to DLQ
worker.on('failed', async (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    await dlq.add('dead-letter', job.data, {
      jobId: job.id,
      attempts: 1
    });
    console.error(`Moved job ${job.id} to DLQ: ${err.message}`);
  }
});

// DLQ consumer — manual inspection and replay
const dlqWorker = new Worker('payments-dlq', async (job) => {
  await notifyAdmin(`Payment job ${job.id} permanently failed`);
});
```

### Consumer Concurrency and Backpressure

```typescript
const worker = new Worker('notifications', sendEmail, {
  concurrency: 10, // max 10 concurrent jobs
  limiter: {
    max: 50,        // max 50 jobs
    duration: 1000  // per 1 second
  }
});
```

See [Backpressure](backpressure.md) and [Bulkhead Pattern](bulkhead-pattern.md).

---

## Advantages

- **Decoupling** — producers and consumers evolve independently; no direct dependency
- **Load leveling** — buffers traffic spikes so consumers process at their own pace
- **Fault isolation** — a consumer crash does not affect producers or other consumers
- **Scalability** — add more consumers to increase throughput (competing consumers pattern)
- **Durability** — messages survive broker restarts (persistent mode)
- **Replayability** — Kafka retains messages; consumers can rewind and reprocess
- **Fan-out** — one event can trigger multiple independent workflows

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Complexity** | Broker is another infrastructure component to operate, monitor, and scale | Use managed services (SQS, Confluent Kafka, Redis Cloud) |
| **Ordering** | Most brokers do not guarantee global order | Partition by key (Kafka); use FIFO (SQS); limit to a single consumer per queue (RabbitMQ) |
| **At-least-once duplication** | Consumers may receive the same message multiple times | Idempotent consumers (see [Idempotency](idempotency.md)) |
| **Message visibility** | SQS/Bull messages are hidden during processing; crash before delete causes redelivery | Idempotent processing; idempotency keys |
| **Backpressure** | Producers may outpace consumers indefinitely | Bounded queue size; concurrency limits; rate limiters |
| **Debugging difficulty** | Async flows are harder to trace, log, and test | [Distributed Tracing](distributed-tracing.md); structured logging; dead-letter queues |

---

## When to Use

- **Decouple services** — Order Service should not block on Notification Service
- **Buffer traffic spikes** — absorb flash sales, webhook bursts, and batch imports
- **Fan-out events** — a single event (e.g. `UserRegistered`) triggers email, analytics, and a welcome coupon
- **Background processing** — image resizing, PDF generation, email delivery, report generation
- **Cross-service communication** — services should not call each other directly; they should exchange messages

---

## When NOT to Use

- **Request-response workflows** — if the caller needs an immediate answer, use HTTP/[gRPC](grpc.md) with a circuit breaker
- **Low-volume, simple systems** — a queue adds operational overhead without benefit
- **Strongly consistent, real-time data** — if stale data is unacceptable, use synchronous reads
- **Small datasets** — if the entire dataset fits in one database, direct calls are simpler

---

## Related Concepts

- [Event-Driven Architecture](event-driven-architecture.md) — message queues are the backbone of event-driven systems
- [Delivery Semantics](delivery-semantics.md) — at-most-once, at-least-once, exactly-once guarantees
- [Idempotency](idempotency.md) — consumers must handle duplicate deliveries
- [Outbox Pattern](outbox-pattern.md) — guarantees at-least-once publication from your database
- [Retry Pattern](retry-pattern.md) — exponential backoff and jitter for message retries
- [Backpressure](backpressure.md) — controlling consumer concurrency to prevent overload
- [Bulkhead Pattern](bulkhead-pattern.md) — separate worker pools per queue so one backlog does not block others
- [Circuit Breaker](circuit-breaker.md) — protect producers from broker unavailability
- [Distributed Tracing](distributed-tracing.md) — trace messages across producer and consumer boundaries
- [Claim-Check Pattern](claim-check-pattern.md) — database-backed consumer claiming when a queue is not available
- Kafka
- RabbitMQ
- Amazon SQS / SNS
- Redis Streams
- BullMQ
- AMQP
- Dead-Letter Queue

---

## Key Takeaways

> Message queues decouple producers from consumers, enabling asynchronous communication, load leveling, and fault isolation. Kafka is ideal for high-throughput event streaming with replayability. RabbitMQ excels at complex routing (direct, topic, fanout) and traditional message queuing. SQS provides a fully managed, serverless option with FIFO ordering for stricter guarantees. BullMQ (Redis Streams) is the most popular choice in the Node.js ecosystem for its simplicity and built-in retry/backoff. Every queue delivers at-least-once by default — consumers must be idempotent (see [Idempotency](idempotency.md)). Always configure a dead-letter queue to capture permanently failed messages for manual inspection.
