# Consistency Models

> The guarantees a distributed data store provides about when and in what order updates are visible to concurrent readers.

---

## What is it?

A consistency model defines the contract between a distributed data store and its clients regarding the visibility of writes. It determines when a write performed by one client becomes visible to reads performed by other clients. Models range from **strong consistency** (reads always see the latest write) to **eventual consistency** (reads may see stale data but will converge over time).

---

## Problem

In a distributed system, data is replicated across multiple nodes. When a client writes to one node, other nodes must be updated. Without a consistency model:

- A client may read stale data from an un-updated replica.
- Two clients may observe different orderings of the same writes.
- Application code cannot reason about what value it will read after a write.

Different applications tolerate different levels of staleness. An inventory system needs strong consistency to prevent overselling; a social media feed can tolerate eventual consistency.

---

## Example

### Strong Consistency

After a write completes, every subsequent read returns that value — regardless of which replica responds.

```text
Client A:  write(x = 1) ──► Node 1
Client B:                 read(x) ──► Node 2  →  returns 1
```

In PostgreSQL with `SELECT ... FOR UPDATE` or a single-leader replication with synchronous reads from the leader:

```typescript
// Read from the leader (single writer) guarantees latest value
const result = await prisma.$queryRawUnsafe(
  'SELECT stock FROM inventory WHERE id = $1 FOR UPDATE',
  productId
);
```

### Eventual Consistency

After a write, reads may return stale values for an unbounded window. Given enough time with no updates, all replicas converge.

```text
Client A:  write(x = 1) ──► Node 1
Client B:                 read(x) ──► Node 2  →  returns 0 (stale)
          (wait)
Client B:                 read(x) ──► Node 2  →  returns 1 (converged)
```

DynamoDB (default), Cassandra, DNS, and CDNs use eventual consistency.

### Causal Consistency

Writes that are causally related (A happened before B) are seen in that order by all clients. Concurrent writes may be seen in different orders.

```typescript
// Client 1 writes a comment, then Client 2 replies to it
// Causal consistency guarantees: if you see the reply, you also see the original comment
await redis.set(`comment:${postId}`, 'First post!');
await redis.set(`reply:${postId}:1`, 'Agreed!');
// No client will see 'Agreed!' without also seeing 'First post!'
```

---

## Architecture / Flow

```text
Consistency Spectrum

    Strong ────────────────────────────────────────────── Eventual
       │                        │                              │
       │                        │                              │
  ┌────┴─────┐          ┌──────┴──────┐               ┌───────┴────────┐
  │ Lineariz- │          │  Sequential │               │  Eventual       │
  │ ability   │          │             │               │  Consistency    │
  └──────────┘          └─────────────┘               └────────────────┘
       │                        │                              │
  Reads always            All clients see              Replicas
  reflect the             operations in                  converge
  latest write            the same order                over time
                          (not necessarily real-time)
```

### Models in Detail

| Model | Guarantee | Latency | Use Case |
|-------|-----------|---------|----------|
| **Strong (Linearizability)** | Reads return the most recent write | High (quorum or sync replication) | Financial ledgers, inventory |
| **Sequential** | Operations appear in some consistent order, but not necessarily real-time order | Medium | Distributed locks, queues |
| **Causal** | Causally related writes are seen in order; concurrent writes can be reordered | Medium | Social feeds, collaborative editing |
| **Read-after-write (Read-your-writes)** | A client always reads its own writes | Low | User profiles, session data |
| **Monotonic Reads** | Successive reads by a client never see older values | Low | Dashboards, activity feeds |
| **Eventual** | All replicas converge given no further writes | Lowest | CDNs, DNS, search indexes |

---

## How it Works

### Strong Consistency (Linearizability)

1. Client sends a write request to any node in the cluster.
2. The node coordinates with a quorum of replicas (e.g. all replicas for a sync write).
3. Once acknowledged, the write is considered committed.
4. Every subsequent read must contact a quorum that includes at least one node with the latest value.
5. Reads block until the latest value is confirmed.
6. The system behaves as if there is a single copy of the data, updated atomically.

### Eventual Consistency

1. Client sends a write to one replica (or any replica in a leaderless system).
2. The replica accepts the write and asynchronously propagates it to other replicas.
3. A subsequent read may hit a replica that has not yet received the update — it returns stale data.
4. Background anti-entropy processes (gossip, hinted handoff, read repair) propagate the write.
5. In the absence of further writes, all replicas eventually converge to the same value.

---

## Advantages

- **Strong consistency** — simplifies application logic; no staleness handling; intuitive
- **Eventual consistency** — higher availability, lower latency, survives partitions better
- **Causal consistency** — good balance; matches human intuition about cause and effect
- **Read-your-writes/Monotonic reads** — simple session-level guarantees without full strong consistency overhead

---

## Trade-offs

| Model | Trade-off |
|-------|-----------|
| **Strong** | Reduces availability during partitions (CAP trade-off); higher latency due to quorum coordination |
| **Eventual** | Application must handle stale reads; conflict resolution required for concurrent writes |
| **Causal** | Requires tracking causality (version vectors); more complex than eventual; not supported by all stores |
| **Read-your-writes** | Often ties client to a specific replica; complicates load balancing |

---

## When to Use

- **Strong consistency** — financial transactions, inventory reservation, distributed locks, leader election
- **Eventual consistency** — CDN content, DNS records, social media feeds, analytics, search indexes
- **Causal consistency** — collaborative editing (Google Docs), comment threads, activity feeds
- **Read-your-writes** — user profile updates, session stores, any "user edits then immediately views" flow
- **Monotonic reads** — dashboards, audit logs, any UI that polls for updates

---

## When NOT to Use

- **Strong consistency** when the system must remain available during network partitions or when low latency is critical
- **Eventual consistency** when correctness depends on reading the latest value (payments, inventory count)
- Any model that forces a consistency guarantee you do not actually need — weaker models are faster

---

## Related Concepts

- [CAP Theorem](cap-theorem.md) — consistency, availability, and partition tolerance define the trade-off space
- [Distributed Transactions](distributed-transactions.md) — strong consistency across services
- [Saga Pattern](saga-pattern.md) — eventual consistency across services with compensating actions
- [Database Concurrency Control](database-concurrency-control.md) — isolation levels and locking at the single-node level
- Consensus Algorithms — how distributed systems agree on a single value (see Consensus Algorithms)
- Quorum
- Vector Clocks
- CRDTs

---

## Key Takeaways

> Consistency models define the visibility guarantees a distributed store provides. Strong consistency (linearizability) is intuitive but expensive and fragile during partitions. Eventual consistency is highly available but forces application-level staleness handling. Causal consistency offers a practical middle ground. Choose the weakest model that your application can tolerate — every level of consistency adds cost and complexity. The CAP theorem frames the fundamental trade-off: you cannot have strong consistency and availability together during a network partition.
