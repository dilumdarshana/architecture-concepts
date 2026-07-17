# Replication

> Keeping copies of the same data on multiple nodes to improve durability, availability, and read throughput.

---

## What is it?

Replication stores the same data on multiple independent nodes. If one node fails, the data is still accessible from another. Replication also enables horizontal read scaling — read requests can be distributed across replicas. The two main approaches are **single-leader** (primary-replica) and **multi-leader** (active-active), with trade-offs in consistency, latency, and conflict handling.

---

## Problem

A single database or storage node is a single point of failure. If it crashes, the system goes down and data may be lost. Even when running, a single node can only handle so many read requests. Without replication:

- **No fault tolerance** — losing one node means losing data
- **Read bottleneck** — a single node must serve every read
- **Geographic latency** — all clients connect to one location regardless of where they are
- **No rolling upgrades** — taking the node down for maintenance stops all traffic

---

## Example

### Single-Leader (Primary-Replica)

One node accepts writes; replicas copy changes asynchronously or synchronously.

```typescript
import { PrismaClient } from '@prisma/client';

const leader = new PrismaClient({ datasourceUrl: process.env.LEADER_DB_URL });
const replica = new PrismaClient({ datasourceUrl: process.env.REPLICA_DB_URL });

// Writes always go to the leader
async function createOrder(data: OrderInput) {
  return leader.order.create({ data });
}

// Reads can go to a replica (eventually consistent)
async function getOrder(id: string) {
  return replica.order.findUnique({ where: { id } });
}

// Reads that need the latest value go to the leader
async function getOrderLatest(id: string) {
  return leader.order.findUnique({ where: { id } });
}
```

### Multi-Leader (Active-Active)

Multiple nodes accept writes and replicate to each other. Conflicts are resolved by the application or by last-writer-wins (LWW).

```text
┌──────────┐         ┌──────────┐
│ Leader A │ ◄────► │ Leader B │
│ (US-East) │         │ (EU-West)│
└──────────┘         └──────────┘
     │                     │
  Write                  Write
  (low latency            (low latency
   for US clients)         for EU clients)
```

---

## Architecture / Flow

### Single-Leader

```text
           ┌──────────┐
           │  Client   │
           └────┬─────┘
                │
          Write │ Read
                │
           ┌────▼─────┐        ┌──────────┐
           │  Leader   │ ────► │  Replica │
           │ (primary) │       │ (read)   │
           └───────────┘       └──────────┘
                │                    │
                │              ┌──────────┐
                └────────────► │  Replica │
                               │ (read)   │
                               └──────────┘
```

### Replication Modes

| Mode | Behaviour | Risk |
|------|-----------|------|
| **Synchronous** | Leader waits for replica acknowledgment before committing | Higher latency; unavailable if replica is down |
| **Asynchronous** | Leader commits without waiting for replicas | Replica lag; data loss if leader crashes before replication |
| **Semi-synchronous** | Leader waits for at least one replica, others async | Balance of safety and latency |

### Multi-Leader Conflict

```text
Time  Client A (US)                  Client B (EU)
 │    write(cart.total = 100)        write(cart.total = 50)
 │       │                               │
 │    Leader A commits                Leader B commits
 │    Replicates to B  ──►            Replicates to A  ──►
 │       │                               │
 │    Conflict! Last-writer-wins: total = 50 (B's timestamp is newer)
 ▼
```

---

## How it Works

1. **Single-Leader**: A client sends a write to the leader.
2. The leader writes to its local storage and appends the change to a replication log.
3. Replicas connect to the leader and pull (or receive) the replication log.
4. Each replica applies the changes in order, maintaining a copy of the data.
5. Reads from replicas may return stale data if replication is asynchronous (replica lag).
6. If the leader fails, a new leader is elected from the replicas (failover) — either manually or via a consensus-based system.
7. **Multi-Leader**: Each leader accepts writes independently and sends its changes to other leaders.
8. Multi-Leader conflicts are resolved by strategies: last-writer-wins (LWW), CRDTs, application-level merge, or error-on-conflict.

---

## Advantages

- **High availability** — if one node fails, others serve reads; failover promotes a replica to leader
- **Read scalability** — distribute reads across replicas
- **Durability** — data survives node failures
- **Geographic distribution** — replicas closer to users reduce latency
- **Backup isolation** — take backups from a replica without impacting the primary
- **Rolling upgrades** — upgrade replicas one at a time with zero downtime

---

## Trade-offs

- **Stale reads** — asynchronous replication creates a window where replicas lag behind the leader
- **Write bottleneck** — single-leader still has one write point; multi-leader adds conflict complexity
- **Conflict resolution** — multi-leader requires a strategy (LWW may lose data; CRDTs are complex)
- **Replication lag** — affects read-after-write consistency; post-replication consistency varies
- **Failover complexity** — promoting a replica to leader is not instantaneous; split-brain risk without consensus
- **Storage overhead** — each replica consumes full storage

---

## When to Use

- **Single-leader** — most applications; simple mental model, strong consistency on leader, read scaling
- **Multi-leader** — multi-region deployments where each region needs local writes; offline-first apps (CouchDB)
- **Leaderless (quorum-based)** — Cassandra, DynamoDB-style systems; highest availability, tunable consistency
- **Asynchronous replication** — when read latency is critical and eventual consistency is acceptable
- **Synchronous replication** — when durability is paramount (financial systems, audit logs)

---

## When NOT to Use

- **Single-leader** when the leader is a single point of failure for writes and you cannot tolerate any write unavailability
- **Multi-leader** when conflict resolution is infeasible or data integrity requires a single source of truth
- **Replication with high write volume** — each write must be replicated; write throughput does not scale horizontally with single-leader
- **When storage cost is prohibitive** — every replica stores a full copy

---

## Related Concepts

- [Consistency Models](consistency-models.md) — replication mode determines consistency guarantees
- [Consensus Algorithms](consensus-algorithms.md) — Raft/Zab for leader election and failover
- [Sharding](sharding.md) — replication copies data; sharding splits data; often used together
- [Consistent Hashing](consistent-hashing.md) — data distribution strategy used in DynamoDB-style replication
- [CAP Theorem](cap-theorem.md) — trade-off between consistency and availability in replication
- [Distributed Systems](distributed-systems.md) — replication is a core distributed systems primitive
- Quorum
- Replication Lag
- Read-after-write Consistency
- CDC (Change Data Capture)

---

## Key Takeaways

> Replication stores copies of data on multiple nodes for fault tolerance and read scalability. Single-leader (primary-replica) is the simplest and most common: writes go to one node, reads can use replicas. Asynchronous replication risks stale reads and data loss on leader failure; synchronous replication avoids these at the cost of latency. Multi-leader enables multi-region writes but requires conflict resolution. Replication and sharding are orthogonal — replication provides redundancy, sharding provides partitioning — and are often combined.
