# Kafka Fundamentals

> A distributed commit log — an append-only, partitioned, replicated record stream that serves as the backbone for event streaming, audit logging, and data pipeline architectures.

---

## What is it?

Apache Kafka is a distributed event streaming platform built around a **commit log** abstraction. Unlike a traditional message queue (where messages are deleted after consumption), Kafka retains records durably and allows consumers to read at any position — past, present, or future. Producers append records to the end of the log; consumers read from any offset.

The key insight: Kafka is not a queue. It is a **log** that happens to support queue-like consumption patterns via consumer groups.

---

## Core Concepts

| Concept | Definition |
|---------|------------|
| **Record** | A single message: key, value, timestamp, optional headers |
| **Topic** | A named category of records — similar to a table in a database |
| **Partition** | An ordered, immutable sequence of records. Each partition is the unit of parallelism and the unit of ordering |
| **Broker** | A Kafka server that stores partitions and serves produce/consume requests |
| **Producer** | A client that publishes records to a topic partition |
| **Consumer** | A client that reads records from a topic partition |
| **Consumer Group** | A set of consumers that cooperate to consume a topic — each partition is assigned to one consumer in the group |
| **Offset** | A sequential ID assigned to each record within a partition. The consumer tracks its position by storing the last committed offset |
| **Leader / Follower** | Each partition has one leader broker (handles reads/writes) and N follower brokers (replicate for durability) |

---

## Topics & Partitions

A topic is split into **partitions**. Partitions are the fundamental unit of parallelism:

```
Topic "orders"
  ┌──────────────┐
  │ Partition 0  │  offset 0  │  offset 1  │  offset 2  │  ...
  ├──────────────┤
  │ Partition 1  │  offset 0  │  offset 1  │  ...
  ├──────────────┤
  │ Partition 2  │  offset 0  │  offset 1  │  offset 2  │  offset 3  │  ...
  └──────────────┘
```

- **Ordering is guaranteed within a partition**, not across partitions.
- To maintain order for a specific entity (e.g., all events for a single order), assign a **key** — all records with the same key go to the same partition.
- Partitions can be distributed across brokers for horizontal scale.
- More partitions = more parallelism for both producers and consumers.

### Partitioning Strategies

| Strategy | How It Works | Use When |
|----------|--------------|----------|
| **Key hash** | `hash(key) % num_partitions` → same key always goes to the same partition | Ordering per entity (order ID, customer ID) |
| **Round-robin** | Records are distributed evenly across partitions without a key | Load balancing, no ordering requirement |
| **Sticky** | Producer batches records for one partition until the batch is full, then moves to the next | Higher throughput than pure round-robin |

```typescript
import { Kafka, Partitioners } from 'kafkajs';

const kafka = new Kafka({ brokers: ['localhost:9092'] });
const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner, // sticky
});

// Key-based partitioning — all events for order-123 land in the same partition
await producer.send({
  topic: 'orders',
  messages: [
    { key: 'order-123', value: JSON.stringify({ status: 'created' }) },
    { key: 'order-123', value: JSON.stringify({ status: 'paid' }) },
  ],
});
```

---

## Offsets

Each record in a partition gets a unique, sequential **offset** — a `long` integer that never changes.

```
Partition 0:  [record@0]  [record@1]  [record@2]  [record@3]  ...
```

The consumer tracks its progress by committing the offset it has processed. On restart, it resumes from the last committed offset.

### Offset Commit Strategies

| Strategy | Description | Risk |
|----------|-------------|------|
| **Auto commit** | Consumer commits periodically (e.g., every 5s). | Records may be re-processed on crash (at-least-once). Records may be skipped if commit happens before processing (at-most-once). |
| **Manual commit** | Consumer commits explicitly after processing each record or batch. | Developer must handle commit timing. Safer — at-least-once if commit after processing. |
| **Seek** | Consumer manually sets its position to a specific offset. Used for replay. | Requires external offset tracking. |

### Where to Start

| Setting | Behaviour | Use When |
|---------|-----------|----------|
| `earliest` | Start from the oldest available record | New consumer that should process all historical data |
| `latest` | Start from the newest record (skip existing) | New consumer that only cares about new data |

---

## Consumer Groups

A consumer group enables **load-balanced consumption** of a topic. Each partition is assigned to exactly one consumer in the group. If there are more consumers than partitions, some consumers sit idle.

```
Topic "orders" (3 partitions)

Consumer Group "email-service"
  Consumer A  ←── Partition 0
  Consumer B  ←── Partition 1
  Consumer C  ←── Partition 2

All three consumers process in parallel. Each partition's order is preserved.
```

- If Consumer B crashes, partitions 1 and 2 are re-assigned to A and C (**rebalance**).
- If a fourth consumer joins, one consumer becomes idle.
- Consumer groups enable both **fan-out** (multiple groups each get all records) and **load balancing** (within a group).

```typescript
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'email-service',
  brokers: ['localhost:9092'],
});

const consumer = kafka.consumer({ groupId: 'email-service' });

await consumer.connect();
await consumer.subscribe({ topic: 'orders', fromBeginning: false });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const order = JSON.parse(message.value!.toString());
    await sendEmail(order);
    // KafkaJS auto-commits after eachMessage succeeds
  },
});
```

### Rebalancing

When a consumer joins or leaves a group, Kafka triggers a **rebalance** — all consumers in the group stop consuming, partitions are reassigned, and each consumer picks up from its last committed offset. During rebalancing, no messages are processed.

---

## Retention & Compaction

Kafka retains records for a configurable period, even after they are consumed.

### Time-Based Retention

```
retention.ms: 604800000  // keep records for 7 days
retention.bytes: -1      // no size limit (or set to cap total partition size)
```

After the retention period expires, old records are deleted. Consumers that read from the beginning will not see deleted records.

### Log Compaction

Compaction turns Kafka into a **changelog** — instead of deleting old records by time, it keeps only the most recent record for each key:

```
Before compaction:
  key: "order-123", value: "pending"
  key: "order-456", value: "pending"
  key: "order-123", value: "paid"        ← latest for order-123
  key: "order-456", value: "shipped"     ← latest for order-456

After compaction:
  key: "order-123", value: "paid"
  key: "order-456", value: "shipped"
```

Use compaction when:
- You need to reconstruct the latest state from the log (e.g., a table snapshot).
- You want to retain only the latest value per key.
- A consumer joins late and should see only the current state, not the full history.

---

## Delivery Semantics

| Semantics | Producer Config | Consumer Config | Behaviour |
|-----------|----------------|-----------------|-----------|
| **At-most-once** | `acks: 0` | Auto-commit before processing | Records may be lost on producer failure. Consumer may skip records on crash. |
| **At-least-once** (default, recommended) | `acks: all` + retries | Commit after processing | Records may be duplicated but never lost. Consumer must handle duplicates via idempotency. |
| **Exactly-once** | `acks: all` + `idempotent: true` + transactional producer | `isolation.level: read_committed` | Best for financial transactions. Higher overhead, requires careful setup. |

```typescript
// Idempotent producer — prevents duplicates within producer session
const producer = kafka.producer({
  idempotent: true,
  maxInFlightRequests: 5, // must be <= 5 for idempotence
});

// Transactional producer — atomic writes across multiple partitions
const producer = kafka.producer({
  transactionalId: 'payment-producer',
  idempotent: true,
});

await producer.connect();
await producer.sendBatch({
  topicMessages: [
    { topic: 'payments', messages: [{ value: 'charged' }] },
    { topic: 'orders', messages: [{ value: 'updated' }] },
  ],
});
await producer.commitOffsets({ topic: 'orders', partition: 0, offset: '5' });
await producer.disconnect();
```

---

## Architecture / Flow

```
Producers                          Kafka Cluster                    Consumer Groups
                                      ┌───────┐
  Producer A (orders) ───────────────►│ Broker 1 │◄──────────────── Consumer Group A
     key: order-123                   │  Part 0  │     (email-service)
     key: order-456                   │  Part 1  │
                                      └───────┘
                                      ┌───────┐
  Producer B (payments) ────────────►│ Broker 2 │◄──────────────── Consumer Group B
     key: order-123                   │  Part 2  │     (analytics-service)
                                      │  Part 3  │
                                      └───────┘
```

1. Producer connects to any broker, discovers partition leaders via metadata API.
2. Producer sends records to the partition leader for the target partition.
3. Leader appends records to the partition log and replicates to followers (configurable `acks`).
4. Consumer in a group subscribes to a topic. Group coordinator assigns partitions.
5. Consumer fetches records from partition leaders, starting from its last committed offset.
6. Consumer processes records and commits the offset (auto or manual).
7. On retention expiry or compaction, old records are deleted from the log.

---

## Advantages

- **Durability** — records are persisted to disk and replicated across brokers. No data loss with `acks: all`.
- **Replayability** — consumers can rewind to any offset and reprocess. Enables bug recovery, backfill, and audit.
- **Ordering per partition** — guaranteed order within a partition via key-based partitioning.
- **High throughput** — sequential disk I/O, batching, zero-copy transfers. Handles millions of records per second.
- **Decoupling** — producers and consumers scale independently. Adding a new consumer group does not affect producers.
- **Long retention** — keeps records for days or weeks, unlike queues that delete on consumption.

---

## Trade-offs

- **Complexity** — Kafka requires operational expertise: broker tuning, partition sizing, rebalancing, monitoring.
- **Ordering limited** — global ordering requires a single partition, which limits parallelism. Use keys for per-entity ordering.
- **Consumer lag** — consumers that cannot keep up will fall behind. Monitor consumer lag; scale by adding partitions.
- **No individual record ack** — consumer commits offset, not individual record. If one record fails, the consumer must handle retry logic externally.
- **Not ideal for low-latency request-response** — Kafka is designed for streaming, not for synchronous RPC.

---

## When to Use

- **Event streaming** — publish events for multiple independent consumers to process
- **Audit logging** — immutable record of every state change, retained for compliance
- **Data pipelines** — ingest large volumes of data for ETL, analytics, or machine learning
- **Event sourcing** — Kafka as the event store with replayable streams
- **Log aggregation** — collect logs from many services into a central stream

---

## When NOT to Use

- **Work queues** — traditional task distribution with individual task acknowledgement (use RabbitMQ or BullMQ)
- **Request-reply** — synchronous communication with low latency requirements (use gRPC or HTTP)
- **Small-scale systems** — managing a Kafka cluster is overhead that a single Redis instance or SQS does not justify
- **Exactly-once delivery to external systems** — Kafka's exactly-once is within Kafka; external side effects still need idempotency

---

## Related Concepts

- [Event-Driven Architecture](event-driven-architecture.md) — Kafka is a backbone for event-driven systems
- [Message Queues](message-queues.md) — Kafka compared to RabbitMQ, SQS, and BullMQ
- [Delivery Semantics](delivery-semantics.md) — at-most-once, at-least-once, exactly-once mapped to Kafka config
- [Event Sourcing](event-sourcing.md) — Kafka as an event store with log compaction for snapshots
- [CQRS](cqrs.md) — Kafka streams build denormalised read models from event streams
- [Polling Strategies](polling-strategies.md) — Kafka consumers pull records differently than SQS short/long polling
- [Database Migrations](database-migrations.md) — Kafka schema evolution via compatibility strategies

---

## Key Takeaways

> Kafka is a distributed commit log, not a queue — records are retained and replayable. Partition is the unit of parallelism: order is guaranteed within a partition, not across partitions. Use key-based partitioning for per-entity ordering. Consumer groups enable load-balanced consumption; rebalancing pauses processing. Always use at-least-once delivery (acks: all, commit after processing) with idempotent consumers. Log compaction turns Kafka into a changelog — useful for state reconstruction. Kafka excels at event streaming, audit, and data pipelines; use a traditional queue for simple work distribution.
