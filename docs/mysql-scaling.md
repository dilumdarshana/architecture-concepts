# MySQL Scaling

> A progression of strategies to grow MySQL from a single instance to support millions of concurrent users — covering vertical scaling, read replicas, caching, connection pooling, sharding, and operational best practices.

---

## What is it?

MySQL scaling is the set of techniques used to increase the capacity of a MySQL-backed system as user count, data volume, and query throughput grow. The approach follows a predictable progression: optimise the single instance first, add replicas for read scale, introduce caching to reduce database load, then shard when writes become the bottleneck. Each step adds capacity at the cost of operational complexity.

---

## Problem

A single MySQL instance running on a single machine has hard limits:

- **CPU** — query execution saturates available cores; complex queries and high concurrency exhaust CPU
- **Memory** — the buffer pool (InnoDB) must fit the working set in RAM; when it does not, disk I/O spikes
- **Disk I/O** — `fsync` for writes, index B-tree page splits, and full table scans compete for disk bandwidth
- **Connections** — each connection consumes thread stack and memory; defaults (151-200 connections) are easily exhausted
- **Replication lag** — a single primary cannot replicate fast enough to keep read replicas current under heavy write load
- **Backup window** — backing up a multi-terabyte database within a nightly window becomes impossible

The system hits these limits in stages. The solution is not to shard immediately — it is to apply each technique in order as the bottleneck shifts.

---

## Example

### Stage 1: Vertical Scaling (Scale Up)

```text
Before:  t3.medium (2 vCPU, 4 GB RAM) → 200 connections max, 500 QPS
After:   r6g.xlarge (4 vCPU, 32 GB RAM) → 5000 connections, 10k QPS

Cost: ~4x more
Benefit: immediate throughput improvement, no application changes
```

When to stop: once you are on the largest instance type available and still hitting limits. At this point, the bottleneck shifts from hardware to single-node concurrency.

### Stage 2: Read Replicas

```typescript
import { createPool } from 'mysql2/promise';

// Primary for writes
const primary = createPool({
  host: 'primary.cluster-xxx.us-east-1.rds.amazonaws.com',
  user: 'app',
  database: 'myapp'
});

// Read replicas for read queries
const replicas = [
  createPool({ host: 'replica-1.cluster-xxx.us-east-1.rds.amazonaws.com', ... }),
  createPool({ host: 'replica-2.cluster-xxx.us-east-1.rds.amazonaws.com', ... }),
];

function getReadPool() {
  // Round-robin across replicas
  const index = Math.floor(Math.random() * replicas.length);
  return replicas[index];
}

async function createOrder(data: OrderInput) {
  // Write goes to primary
  return primary.execute('INSERT INTO orders ...', [data]);
}

async function getOrders(userId: string) {
  // Read goes to a replica
  const [rows] = await getReadPool().execute(
    'SELECT * FROM orders WHERE user_id = ?', [userId]
  );
  return rows;
}

async function getOrderForUpdate(orderId: string) {
  // Read-after-write consistency — go to primary
  const [rows] = await primary.execute(
    'SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]
  );
  return rows[0];
}
```

### Stage 3: Connection Pooling with ProxySQL

```text
Application ──► ProxySQL ──► Primary
                  │
                  ├──► Replica 1
                  ├──► Replica 2
                  └──► Replica 3

ProxySQL handles:
- Connection pooling (multiplex many app connections into fewer DB connections)
- Read/write splitting
- Query routing (e.g. reporting queries to a specific replica)
- Query caching
- Automatic reconnection on failover
```

```sql
-- ProxySQL admin interface
INSERT INTO mysql_query_rules
  (rule_id, active, match_pattern, destination_hostgroup)
VALUES
  (1, 1, '^SELECT .* FROM orders WHERE', 1),  -- read hostgroup
  (2, 1, '^INSERT|UPDATE|DELETE', 2);          -- write hostgroup
```

### Stage 4: Caching Layer

Reduce database reads by caching hot data in Redis:

```typescript
import { createClient } from 'redis';
import { createPool } from 'mysql2/promise';

const redis = createClient({ url: 'redis://cache-cluster:6379' });
const db = createPool({ host: 'primary', database: 'myapp' });

async function getUserProfile(userId: string) {
  // Check cache first
  const cached = await redis.get(`user:${userId}`);
  if (cached) return JSON.parse(cached);

  // Cache miss — query database
  const [rows] = await db.execute(
    'SELECT id, name, email FROM users WHERE id = ?', [userId]
  );
  const profile = rows[0];

  // Store in cache with TTL
  await redis.setEx(`user:${userId}`, 300, JSON.stringify(profile)); // 5 min TTL
  return profile;
}
```

### Stage 5: Sharding with Vitess

```text
Application
     │
     ▼
  Vitess VTGate (proxy)
     │
     ├──► Shard 1 (users A-F)
     ├──► Shard 2 (users G-M)
     ├──► Shard 3 (users N-S)
     └──► Shard 4 (users T-Z)
```

```typescript
// Vitess handles routing transparently via shard key
// The application just connects to VTGate as if it were a single MySQL instance
const vtgate = createPool({
  host: 'vtgate-cluster.example.com',
  port: 15306,
  user: 'app',
  database: 'myapp'
});

// Vitess routes this to the correct shard based on user_id
await vtgate.execute(
  'INSERT INTO orders (user_id, total) VALUES (?, ?)',
  ['user-abc', 5000]
);
```

---

## Architecture / Flow

### The Scaling Progression

```text
QPS (log scale)
    │
1M  │                          ┌──── Sharding
    │                          │
100k│                    ┌─────┤
    │                    │     └──── Vitess / ProxySQL
10k │              ┌─────┤
    │              │     └────────── Cache (Redis)
1k  │        ┌─────┤
    │        │     └──────────────── Read Replicas
100 │  ┌─────┤
    │  │     └────────────────────── Vertical Scale
10  │  │
    │  │
    └──┴────────────────────────────────────────► Time
       Application     Connection     Cache        Shard
       optimisation    pooling
```

### The Bottleneck Shift

```text
Stage                    Bottleneck                     Solution
──────────────────────────────────────────────────────────────────
Single instance          CPU / RAM / Disk I/O            Vertical scaling
Vertical scaling        Connection count / read QPS     Read replicas
Read replicas           Replication lag / write QPS     Connection pooling + cache
Caching                 Cache hit ratio / write QPS     Query optimisation
Query optimised         Write throughput                Sharding
Sharded                 Cross-shard queries / ops       Denormalisation, fan-out
```

---

## How it Works

### Vertical Scaling

1. Move the database to a larger instance type with more CPU cores, RAM, and higher IOPS storage.
2. Tune InnoDB settings: `innodb_buffer_pool_size` (70-80% of RAM), `innodb_log_file_size`, `innodb_io_capacity`.
3. Increase `max_connections` carefully — each connection consumes memory.
4. Monitor `SHOW GLOBAL STATUS` for `Threads_running`, `Innodb_buffer_pool_reads` (page reads from disk — should be close to zero).
5. Benefits are immediate and require zero application changes.

### Read Replicas

1. Enable binary logging on the primary (`log_bin = ON`).
2. Configure replicas to connect to the primary and stream the binary log.
3. Route all `SELECT` queries to replicas; route `INSERT`/`UPDATE`/`DELETE` to the primary.
4. Handle replication lag — read-after-write queries may see stale data if they hit a replica.
5. Add a caching layer to reduce replica read pressure.

### Connection Pooling

1. Deploy ProxySQL or use AWS RDS Proxy between the application and database.
2. The application opens connections to the proxy; the proxy maintains a smaller pool of persistent connections to MySQL.
3. The proxy multiplexes application requests across the connection pool — 1000 app connections may use only 50 database connections.
4. The proxy handles read/write splitting and failover transparently.

### Caching

1. Install Redis or Memcached alongside the application.
2. Identify hot queries — queries that return the same result repeatedly (user profiles, product details, configuration).
3. For each hot query, compute a cache key from the query parameters.
4. Check cache before the database; store the result with a TTL after fetching from the database.
5. Use cache invalidation (TTL expiry, write-through, or explicit eviction on data change).
6. Monitor cache hit ratio — below 80% means the cache is not effective.

### Sharding (Horizontal Scaling)

1. Choose a shard key — the column that determines which shard a row belongs to (typically `user_id`, `tenant_id`, `customer_id`).
2. Partition data across multiple MySQL instances either manually or using a proxy like Vitess.
3. Each shard is a standalone MySQL instance with a subset of the data.
4. Queries that include the shard key are routed to the correct shard (Vitess handles this automatically).
5. Cross-shard queries (aggregations, joins across shards) require scatter-gather or denormalisation.
6. Resharding (adding more shards) is the most complex operation — Vitess handles automated resharding with minimal downtime.

---

## Advantages

- **Vertical scaling** — simplest; no application changes; immediate improvement
- **Read replicas** — linear read scaling; no application logic change for read path; built-in to RDS/Aurora
- **Connection pooling** — prevents connection exhaustion; multiplexing reduces DB load; transparent to application
- **Caching** — 10-100x faster than database reads; reduces DB load significantly; CDN for API responses
- **Sharding** — write throughput scales horizontally; no single-node limit on data size; independent failure domains
- **Vitess** — automated sharding, resharding, and failover; MySQL-compatible; proven at YouTube scale

---

## Trade-offs

| Technique | Complexity | Cost | Limitation |
|-----------|------------|------|------------|
| Vertical scaling | None | Medium (bigger instances cost more) | Hits ceiling; single point of failure |
| Read replicas | Low | Low-Medium (replica instances) | Replication lag; read-only; does not help writes |
| Connection pooling | Low | Low (ProxySQL / RDS Proxy cost) | Adds a proxy hop; another component to manage |
| Caching | Low-Medium | Low (Redis instance) | Cache invalidation complexity; extra network hop; stale data risk |
| Sharding | Very high | High (N instances + orchestration) | Cross-shard queries; resharding complexity; operational overhead |

---

## When to Use

- **Vertical scaling** — first step when you hit any resource limit; happens naturally as your instance type grows
- **Read replicas** — read QPS exceeds what a single instance can serve; reporting or analytics queries running on the primary
- **Connection pooling** — application connection count exceeds MySQL `max_connections`; connection storms during deployment
- **Caching** — same data read repeatedly with low write frequency; expensive queries (JOINs, aggregations) that can be precomputed
- **Sharding** — write QPS exceeds single-instance capacity; dataset too large for a single instance (multi-TB); growth projection exceeds vertical scaling ceiling

---

## When NOT to Use

- **Vertical scaling** — when you are already on the largest instance and still hitting limits (shift to horizontal approach)
- **Read replicas** — when write throughput is the bottleneck (replicas do not help writes); when stale reads are unacceptable and read-after-write consistency is critical
- **Connection pooling** — when you have few connections and no connection exhaustion issue (unnecessary complexity)
- **Caching** — when data changes too frequently (low hit ratio); when strong consistency requires every read to be fresh
- **Sharding** — when your dataset fits on one node (premature optimisation); when frequent cross-shard queries would dominate; when the team lacks operational maturity to manage a sharded cluster

---

## Related Concepts

- [Replication](replication.md) — read replicas are single-leader replication
- [Sharding](sharding.md) — horizontal data partitioning for write scalability
- [Consistent Hashing](consistent-hashing.md) — algorithm used by Vitess and proxy-based sharding
- [Circuit Breaker](circuit-breaker.md) — protect the application from database connection failures
- [Bulkhead Pattern](bulkhead-pattern.md) — separate connection pools for read and write paths
- [Graceful Shutdown](graceful-shutdown.md) — drain database connections before shutting down
- [Database Concurrency Control](database-concurrency-control.md) — ACID, locking, and isolation at the per-instance level
- [Rate Limiting](rate-limiting.md) — protect the database from traffic spikes
- Vitess
- ProxySQL
- Amazon RDS / Aurora
- PlanetScale

---

## Key Takeaways

> MySQL scaling follows a predictable progression: vertical scale first (easiest, no code changes), then add read replicas (read scale), connection pooling (connection management), caching (reduce read pressure), and finally sharding (write scale). Do not skip stages — sharding is the most complex step and should be deferred until it is unavoidable. Most systems never need to shard: vertical scaling + read replicas + caching handles millions of users for most workloads. When you do need to shard, use a proven proxy like Vitess rather than building a custom sharding layer. At every stage, monitor the bottleneck (CPU, memory, IOPS, connections, replication lag) to know when to advance to the next technique.
