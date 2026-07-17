# Sharding

> Splitting a large dataset across multiple databases or nodes so that each node holds a subset of the data.

---

## What is it?

Sharding (also called horizontal partitioning) distributes rows of a database table across multiple database instances. Each shard holds a subset of the data based on a shard key (e.g. `customer_id`, `region`). Sharding allows a system to store and query datasets larger than what a single node can handle, and to distribute write traffic across many nodes.

---

## Problem

A single database instance has finite storage, CPU, and memory. As data grows:

- Storage fills up — you cannot fit a billion rows on one machine.
- Write throughput is capped by the single node's disk I/O and CPU.
- Query performance degrades as indexes grow larger than memory.
- Backup and recovery take hours or days.

Vertical scaling (bigger machine) has limits and is expensive. Sharding splits the data horizontally so that each shard is a regular database operating on its subset — keeping indexes small, writes distributed, and storage bounded.

---

## Example

### Range-Based Sharding

Partition rows by a range of the shard key:

```text
Shard 1: customers A–F     Shard 2: customers G–M
Shard 3: customers N–S     Shard 4: customers T–Z

Each shard runs on a separate PostgreSQL instance.
```

### Hash-Based Sharding

Partition by hash of the shard key — ensures even distribution:

```typescript
function getShard(customerId: string, shardCount: number): number {
  const hash = createHash('md5').update(customerId).digest('hex');
  return parseInt(hash.substring(0, 8), 16) % shardCount;
}
```

### Node.js Router

```typescript
import { PrismaClient } from '@prisma/client';

const shards = [
  new PrismaClient({ datasourceUrl: process.env.SHARD_1_URL }),
  new PrismaClient({ datasourceUrl: process.env.SHARD_2_URL }),
  new PrismaClient({ datasourceUrl: process.env.SHARD_3_URL }),
  new PrismaClient({ datasourceUrl: process.env.SHARD_4_URL }),
];

function getShard(customerId: string): PrismaClient {
  // Consistent hashing for minimal rebalancing
  const index = consistentHash(customerId, shards.length);
  return shards[index];
}

async function getOrders(customerId: string) {
  const shard = getShard(customerId);
  return shard.order.findMany({
    where: { customerId }
  });
}

async function placeOrder(customerId: string, data: OrderInput) {
  const shard = getShard(customerId);
  return shard.$transaction(async (tx) => {
    // All operations within a shard are ACID
    return tx.order.create({ data: { ...data, customerId } });
  });
}
```

---

## Architecture / Flow

```text
                 ┌──────────────┐
                 │  API Gateway  │
                 └──────┬───────┘
                        │
                 ┌──────▼───────┐
                 │  Shard Router │
                 └──────┬───────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
    ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
    │  Shard 1  │ │  Shard 2  │ │  Shard 3  │
    │ cust A–F  │ │ cust G–M  │ │ cust N–Z  │
    │ PG        │ │ PG        │ │ PG        │
    └───────────┘ └───────────┘ └───────────┘
```

### Sharding Strategies

| Strategy | How it Works | Pros | Cons |
|----------|-------------|------|------|
| **Range** | Key range → shard | Simple; range queries stay on one shard | Hot spots (recent users, active regions) |
| **Hash** | Hash(key) % N | Even distribution | Range queries hit all shards |
| **Consistent Hash** | Hash ring with virtual nodes | Minimal rebalancing on reshard | More complex; still no range queries |
| **Directory-based** | Lookup table maps key → shard | Flexible; dynamic migration | Lookup indirection; single point of failure |

### Resharding

Adding or removing shards requires moving data. With hash-based sharding, changing N from 4 to 5 remaps most keys. Consistent hashing reduces this to 1/N.

```text
Before: N=4, hash % 4
After:  N=5, hash % 5
→ ~80% of keys must move to a new shard
```

---

## How it Works

1. A shard key is chosen — a column (or set of columns) that determines which shard a row belongs to (e.g. `customer_id`, `order_id`, `region`).
2. The shard key is hashed or ranged to determine the target shard.
3. Every write and read includes the shard key so the router can direct the request to the correct shard.
4. Each shard is an independent database — transactions, indexes, and constraints are per-shard.
5. Cross-shard queries (e.g. "find all orders by this customer") require scatter-gather: the router sends the query to every shard and merges the results.
6. Cross-shard transactions are not ACID — they require distributed transaction coordination (2PC) or eventual consistency via Sagas.
7. When a shard grows too large, it can be split into two shards (resharding). This is the most complex operational task in a sharded system.

---

## Advantages

- **Horizontal scalability** — add more shards to handle more data and more write throughput
- **Independent shards** — each shard is a normal database; no special software needed per shard
- **Isolation** — a hot shard does not affect other shards' performance
- **Smaller indexes** — each shard's indexes fit in memory, keeping queries fast
- **Parallel queries** — scatter-gather reads multiple shards concurrently

---

## Trade-offs

- **Cross-shard queries** — joins, aggregations, and transactions across shards are complex or impossible
- **Resharding complexity** — splitting or merging shards requires data migration with minimal downtime
- **Shard key selection** — a bad key (e.g. monotonically increasing ID) creates hot spots
- **Operational overhead** — more databases to monitor, backup, and manage
- **No global constraints** — unique constraints, foreign keys, and secondary indexes are per-shard
- **Scatter-gather latency** — queries that hit every shard are slow with many shards

---

## When to Use

- Dataset exceeds a single node's storage or write capacity (typically > 1TB or > 10k writes/sec)
- Workload is naturally partitionable by a key (customer, tenant, region)
- Write throughput must scale horizontally
- Data can tolerate eventual consistency across shards (most queries are per-shard)

---

## When NOT to Use

- **Workload fits on one node** — sharding adds complexity without benefit
- **Frequent cross-shard queries** — scatter-gather gets expensive quickly
- **Global uniqueness constraints** — enforcing uniqueness across shards requires coordination
- **Small dataset** — the operational overhead of multiple databases outweighs the gains
- **Early-stage startup** — premature sharding is a common mistake; vertical scaling and caching are often sufficient

---

## Related Concepts

- [Consistent Hashing](consistent-hashing.md) — the preferred algorithm for hash-based sharding
- [Replication](replication.md) — replication copies data (for durability); sharding splits data (for scale); often combined
- [Distributed Systems](distributed-systems.md) — sharding is a core technique for distributed databases
- [Distributed Transactions](distributed-transactions.md) — cross-shard transaction coordination
- [CAP Theorem](cap-theorem.md) — sharded systems face CAP trade-offs
- [Database Concurrency Control](database-concurrency-control.md) — per-shard ACID guarantees
- Vitess
- Citus (PostgreSQL extension)
- DynamoDB partitions
- MongoShake

---

## Key Takeaways

> Sharding splits a dataset across independent databases so each holds a subset. It is the primary mechanism for horizontal write scaling and storing datasets larger than a single node. The shard key determines distribution and is the most important design decision — a poor key causes hot spots and uneven load. Cross-shard operations (joins, transactions) are expensive; design the shard key so that most queries touch only one shard. Resharding is complex; consider using a database that handles sharding automatically (Vitess, Citus, CockroachDB). Do not shard until you must — vertical scaling and caching come first.
