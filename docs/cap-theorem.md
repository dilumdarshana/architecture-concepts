# CAP Theorem

> A distributed system can guarantee only two of three properties — Consistency, Availability, and Partition Tolerance — forcing a trade-off during network partitions.

---

## What is it?

The **CAP Theorem** (Brewer's Theorem) states that a distributed data store can provide at most two of the following three guarantees simultaneously:

| Property | Meaning |
|----------|---------|
| **Consistency (C)** | Every read receives the most recent write or an error. All nodes see the same data at the same time. |
| **Availability (A)** | Every request receives a non-error response, without guarantee that it contains the most recent write. |
| **Partition Tolerance (P)** | The system continues to operate despite an arbitrary number of messages being dropped or delayed between nodes. |

Because network partitions are inevitable in any [Distributed System](distributed-systems.md), every system must choose between **CP** (Consistency + Partition Tolerance) and **AP** (Availability + Partition Tolerance). Choosing CA is not realistic in production — if the network partitions, you must choose to either reject writes (CP) or accept stale reads (AP).

---

## Problem

In a distributed database or service, data is replicated across multiple nodes. When a network partition occurs — the link between two nodes fails — the nodes cannot synchronise with each other. The system must decide:

- **Option A (CP)**: Refuse writes on the partitioned side until the partition heals. Reads return the latest consistent data but some requests fail.
- **Option B (AP)**: Accept writes on both sides. Data diverges (becomes inconsistent) but the system stays up. When the partition heals, conflict resolution merges the divergent data.

Without understanding this trade-off, teams design systems that promise both strong consistency and high availability during partitions — which is impossible. The choice affects database selection, replication strategy, and API design.

---

## Example

### CP System — etcd / ZooKeeper

These systems prioritise consistency. If a node cannot reach the majority (quorum), it stops accepting writes.

```typescript
// etcd requires a quorum majority for writes
// If the leader loses connection to the majority, writes are rejected

// This write fails if the cluster cannot form a quorum
await etcd.put('/config/database-url', 'postgres://...');
// Error: etcdserver: request timed out (no quorum)
```

Use case: leader election, distributed configuration — where stale reads are worse than temporary unavailability.

### AP System — Amazon DynamoDB / Cassandra

These systems prioritise availability. Every node accepts writes at any time, and conflicts are resolved later (e.g. last-write-wins or application-level merge).

```typescript
// DynamoDB accepts writes on any reachable node
// Data may diverge temporarily across regions

await dynamoDb.putItem({
  TableName: 'Orders',
  Item: { orderId: { S: '123' }, status: { S: 'confirmed' } },
  // Eventually consistent read by default
});
```

Use case: shopping carts, user profiles — where availability is more important than absolute consistency.

### Relational Databases (PostgreSQL) — CA Without Partition Tolerance

A single-node PostgreSQL instance is consistent (ACID) and available, but not partition tolerant — if the node fails, the system is unavailable. With streaming replication, the system becomes CP: the primary is the single writer; if it partitions from replicas, it cannot be promoted without risking data loss.

---

## Architecture / Flow

```text
            Network Partition
    ┌──────────────────────────────┐
    │                              │
    ▼                              ▼
Node A                           Node B
  │                                │
  │  Write x = 1                   │  Write x = 2
  │  Replicate to B ──── X ────►  │  (cannot reach A)
  │                                │
  │                                │
  CP System:                       │
  │  Node A rejects writes         │  Node B rejects writes
  │  (no quorum)                   │  (no quorum)
  │  Read returns x = 1           │  Read fails
  │                                │
  AP System:                       │
  │  Node A accepts writes         │  Node B accepts writes
  │  Read returns x = 1           │  Read returns x = 2
  │  (partition heals → conflict   │
  │   resolution merges x)         │
```

### PACELC Extension

CAP addresses behaviour during a partition (P). **PACELC** extends this: if there is no partition, the system chooses between Latency (L) and Consistency (C):

```text
          ┌── Partition? ──┐
          │                │
          ▼                ▼
        Yes (P)           No (E = Else)
          │                │
          ▼                ▼
     Trade-off:       Trade-off:
     C vs A           L vs C
```

| System | During Partition | Normal Operation |
|--------|-----------------|------------------|
| DynamoDB | AP — available, eventually consistent | PC/EC — low latency, eventual consistency |
| PostgreSQL (single primary) | CP — consistent, unavailable | PC/EC — low latency, strong consistency |
| Cassandra | AP — available, eventually consistent | PC/EL — low latency, eventual consistency |

---

## How it Works

1. A distributed system replicates data across multiple nodes for fault tolerance.
2. Under normal operation, nodes communicate to keep replicas synchronised.
3. A network partition occurs — some nodes cannot reach others.
4. The partition splits the system into two or more groups that cannot communicate.
5. On the isolated side of the partition:
   - **CP systems** reject writes (or reject reads) to prevent stale or divergent data. They can serve reads only if a consistent quorum is available.
   - **AP systems** continue to accept writes and reads on all sides. Data diverges. When the partition heals, conflict resolution (e.g. last-write-wins, vector clocks, CRDTs) merges the divergent states.
6. The choice of CP vs AP determines database technology, replication factor, consistency levels (quorum, one, all), and API semantics.

---

## Advantages

| Choice | Advantages |
|--------|------------|
| **CP (Consistency + Partition Tolerance)** | Strong consistency guarantees; no conflicting data to resolve; simpler application logic |
| **AP (Availability + Partition Tolerance)** | System stays up during partitions; writes are never rejected; better user-facing availability |

---

## Trade-offs

| Choice | Trade-offs |
|--------|------------|
| **CP** | Writes/reads may fail during partitions; lower availability; requires quorum-based consensus |
| **AP** | Stale reads during partitions; conflict resolution complexity (last-write-wins, CRDTs, manual merge); application must handle inconsistent data |

---

## When to Use

| System Type | Recommended Choice | Rationale |
|-------------|-------------------|-----------|
| **Financial ledger** | CP | Stale reads and data divergence are unacceptable; temporary unavailability is tolerable |
| **Leader election / config** | CP | A stale configuration read or split-brain is worse than a timeout |
| **Inventory system** | CP | Overselling due to stale reads has real cost; temporary rejection is preferable |
| **Shopping cart** | AP | Users can always add items; conflict resolution (merge carts) is acceptable |
| **Social media feed** | AP | Stale reads are acceptable; availability is the priority |
| **IoT / sensor data** | AP | Data can be overwritten or reconciled later; sensors must always be able to write |

---

## When NOT to Use

- **CP is wrong when** — the system must always accept writes and cannot tolerate any request failures (user-facing systems that reject customers during partitions lose revenue).
- **AP is wrong when** — stale reads cause irreversible errors (double payments, overselling unique resources, safety-critical systems).
- **Ignoring the trade-off is wrong** — claiming "strong consistency + high availability" without acknowledging partition behaviour is misleading; every distributed system makes this choice implicitly or explicitly.

---

## Related Concepts

- [Distributed Systems](distributed-systems.md) — CAP is the foundational theorem for understanding distributed data trade-offs
- [Distributed Transactions](distributed-transactions.md) — 2PC provides strong consistency (CP) across participants at the cost of availability
- [Database Concurrency Control](database-concurrency-control.md) — single-node ACID provides CA but is not partition tolerant by itself
- [Eventual Consistency](consistency-models.md) — AP systems use eventual consistency; CP systems use strong consistency
- [Delivery Semantics](delivery-semantics.md) — at-least-once delivery is an availability trade-off; exactly-once is a consistency trade-off
- PACELC
- Quorum
- Conflict-Free Replicated Data Types (CRDTs)
- Vector Clocks

---

## Key Takeaways

> CAP Theorem states that a distributed system must choose between Consistency and Availability when a network partition occurs — it cannot provide both. In practice, every system is CP or AP because partitions are inevitable. CP systems prioritise correctness (reject writes during partitions); AP systems prioritise uptime (accept writes everywhere, resolve conflicts later). The PACELC extension adds the normal-operation trade-off between Latency and Consistency. Choose based on whether stale reads or request failures are more costly for your use case.
