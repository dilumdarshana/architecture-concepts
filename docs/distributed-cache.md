# Distributed Cache

> A cache spread across multiple nodes that acts as a single shared, high-speed data layer, combining the latency benefits of caching with the capacity and availability of a distributed system.

---

## What is it?

A distributed cache is a cache whose data is partitioned and replicated across multiple nodes (e.g. Redis Cluster, Memcached, Hazelcast). To the application it looks like a single cache, but internally it is a distributed system: keys are spread across nodes, nodes can fail and be replaced, and data can be replicated for availability. This is distinct from a single-instance cache, which has a fixed capacity and a single point of failure.

---

## Problem

[Caching Strategies](caching-strategies.md) assumes a single cache instance. As data and traffic grow, a single cache hits three walls:

- **Capacity** — one node's RAM is finite; the working set of hot data eventually exceeds it, forcing evictions and more database reads.
- **Availability** — a single cache is a single point of failure; if it goes down, every request falls through to the database (a cache stampede at the worst possible moment).
- **Throughput** — one node has a CPU and network ceiling; it cannot serve an unbounded request rate.

A distributed cache solves these by spreading data across many nodes, replicating it for fault tolerance, and scaling horizontally as demand grows.

---

## Example

### Partitioning with Consistent Hashing

Keys are distributed across nodes using [Consistent Hashing](consistent-hashing.md), so adding or removing a node only moves a fraction of keys:

```text
Client ──► hash("user:123") ──► Node B (cache-b:6379)
Client ──► hash("order:456") ──► Node A (cache-a:6379)
Client ──► hash("product:789") ──► Node C (cache-c:6379)
```

### Node.js Implementation (Redis Cluster)

```typescript
import { createCluster } from 'redis';

const cluster = createCluster({
  rootNodes: [
    { url: 'redis://cache-a:6379' },
    { url: 'redis://cache-b:6379' },
    { url: 'redis://cache-c:6379' },
  ],
});

await cluster.connect();

// The client transparently routes each key to the owning node
async function getProduct(id: string) {
  const key = `product:${id}`;
  const cached = await cluster.get(key);
  if (cached) return JSON.parse(cached);

  const product = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  if (product) {
    await cluster.setEx(key, 3600, JSON.stringify(product));
  }
  return product;
}
```

The client library handles the hash-ring lookup, node failover, and retries — the application code is identical to using a single Redis instance.

---

## Architecture / Flow

```text
                    Application
                         │
                         │  GET product:123
                         ▼
              ┌───────────────────────┐
              │   Redis Cluster       │
              │   (client library)    │
              │   consistent hashing  │
              └──────────┬────────────┘
                         │ routes key by hash
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      Node A          Node B          Node C
   (cache-a)       (cache-b)       (cache-c)
   product:111     product:123     product:789
   order:222       order:456       order:333
          │              │              │
          └──────┬───────┴──────┬───────┘
                 │   replication│ (optional)
                 ▼              ▼
             Replica A      Replica B
```

---

## How it Works

1. **Partitioning** — keys are mapped to nodes via consistent hashing (or hash slots in Redis Cluster), so each node owns a subset of keys.
2. **Routing** — the client library computes the owning node for a key and sends the request directly to it; no central coordinator is needed.
3. **Replication** — each primary node can have replicas; writes go to the primary and are propagated to replicas for read scaling and failover.
4. **Failover** — when a node becomes unreachable, the cluster promotes a replica (or reassigns its hash slots) and the client retries against the new owner.
5. **Resharding** — when a node is added or removed, only the affected hash slots/keys move, minimising disruption.
6. **Eviction** — each node enforces its own memory policy (LRU/LFU/TTL) independently, so capacity scales with the number of nodes.

---

## Advantages

- **Horizontal scaling** — add nodes to increase total cache capacity and throughput.
- **High availability** — replication and failover mean a node loss does not take the cache down.
- **Single logical cache** — the application sees one cache; partitioning is hidden by the client.
- **Reduced database load** — a larger working set fits in memory, so more reads are served from cache.
- **Geographic distribution** — nodes can be placed near users or services to reduce latency.

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Consistency** | A distributed cache is an AP system — replicas can serve stale data after a write | Prefer primary reads for critical data; accept eventual consistency for cache |
| **Hot keys** | A single popular key lands on one node, overloading it | Replicate hot keys to multiple nodes; shard by finer-grained keys |
| **Network overhead** | Cross-node coordination and client routing add latency vs a local cache | Use a multi-level cache (L1 in-memory + distributed L2) |
| **Operational complexity** | Cluster setup, resharding, monitoring, and failover are harder than a single instance | Use a managed service (ElastiCache, MemoryDB) |
| **Cache stampede on node loss** | A failed node's keys all miss at once, hitting the database | Replication, mutex locks, stale-while-revalidate |
| **Cost** | Many nodes with RAM cost more than one | Right-size; monitor hit ratio; use eviction policies |

---

## When to Use

- **Working set exceeds one node's RAM** — hot data no longer fits in a single cache instance.
- **High availability required** — the cache must survive a node failure without falling through to the database.
- **Read-heavy workloads at scale** — many services share a large, hot dataset (product catalog, sessions, reference data).
- **Multi-service access** — several services need a shared cache with a consistent view of hot data.
- **Scaling path** — you have outgrown [Caching Strategies](caching-strategies.md) on a single instance.

---

## When NOT to Use

- **Small working set** — if hot data fits in one node, a single cache is simpler and cheaper.
- **Strong consistency** — a distributed cache is eventually consistent; use the database for data that must be immediately fresh.
- **Write-heavy workloads** — frequent invalidation makes the cache ineffective regardless of how it is distributed.
- **Low operational maturity** — running a cluster requires monitoring, failover, and resharding expertise.
- **Tiny datasets** — if the whole dataset fits in the database buffer pool, caching adds complexity without benefit.

---

## Related Concepts

- [Caching Strategies](caching-strategies.md) — the patterns (cache-aside, write-through) that run on top of a distributed cache
- [Consistent Hashing](consistent-hashing.md) — the partitioning technique that distributes keys across cache nodes
- [Replication](replication.md) — how cache nodes replicate data for availability and read scaling
- [CAP Theorem](cap-theorem.md) — a distributed cache is an AP system; consistency is traded for availability
- [Distributed Lock](distributed-lock.md) — Redis SET NX used for cache stampede prevention
- [Circuit Breaker](circuit-breaker.md) — fall through to the database when the cache cluster is degraded
- [Backpressure](backpressure.md) — meter cache miss storms to protect the database
- [MySQL Scaling](mysql-scaling.md) — caching is a key stage before sharding in the scaling progression
- Redis Cluster
- Memcached
- Hazelcast

---

## Key Takeaways

> A distributed cache is a cache that is also a distributed system: keys are partitioned across nodes via consistent hashing, replicated for availability, and resharded with minimal disruption. It scales capacity and throughput horizontally and survives node failures, at the cost of eventual consistency and operational complexity. Use it when the hot working set outgrows a single node or when the cache must be highly available. For strong consistency, small datasets, or write-heavy workloads, a single cache or the database itself is the better choice.