# Caching Strategies

> Storing frequently accessed data in a fast, temporary storage layer to reduce latency, decrease database load, and improve system throughput.

---

## What is it?

Caching stores a copy of data in a high-speed access layer (typically Redis, Memcached, or in-memory) so that future requests for the same data can be served faster than fetching it from the primary data store. The key decisions are: **what to cache**, **how long to cache it**, **how to keep the cache consistent with the source of truth**, and **which caching strategy to use** — cache-aside, read-through, write-through, write-behind, or a combination.

---

## Problem

Every read from a database takes time — network round trip, query parsing, index traversal, disk I/O for cold data. Under load, these costs compound:

- A single database query taking 50ms becomes 5000ms when 100 users hit it simultaneously.
- Expensive queries (JOINs across 10 tables, aggregations over millions of rows) consume CPU and IOPS on every request.
- The database connection pool fills up with slow queries, starving faster ones.
- As data grows beyond the buffer pool, more reads hit disk, latency spikes, and the database becomes the bottleneck.

Caching breaks the direct path between every request and the database by storing the result of expensive operations closer to the application.

---

## Example

### Without Caching

```typescript
// Every request queries the database — slow under load
async function getProduct(id: string) {
  return db.query('SELECT * FROM products WHERE id = ?', [id]);
}
```

### With Cache-Aside (the most common strategy)

```typescript
import { createClient } from 'redis';
import { createPool } from 'mysql2/promise';

const cache = createClient({ url: 'redis://localhost:6379' });
const db = createPool({ /* connection config */ });

async function getProduct(id: string) {
  const key = `product:${id}`;

  // 1. Check cache
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);  // cache hit

  // 2. Cache miss — query database
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  const product = rows[0];

  // 3. Store in cache with TTL
  if (product) {
    await cache.setEx(key, 3600, JSON.stringify(product)); // 1 hour TTL
  }

  return product;
}
```

---

## Architecture / Flow

### Caching Strategies Comparison

```text
Cache-Aside (Lazy Loading)
  Application                    Cache                  Database
     │                             │                       │
     │  GET product:123            │                       │
     │ ────────────────────────►   │                       │
     │  miss (nil)                 │                       │
     │ ◄──────────────────────────-│                       │
     │                             │                       │
     │  SELECT * FROM products     │                       │
     │ ───────────────────────────────────────────────►   │
     │  result                     │                       │
     │ ◄─────────────────────────────────────────────────  │
     │                             │                       │
     │  SET product:123 result     │                       │
     │ ────────────────────────►   │                       │
     │                             │                       │
     │  (next request)                                  (no hit)
     │  GET product:123            │                       │
     │ ────────────────────────►   │                       │
     │  result (cache hit)         │                       │
     │ ◄──────────────────────────-│                       │

Write-Through
  Application                    Cache                  Database
     │                             │                       │
     │  UPDATE product SET name    │                       │
     │ ────────────────────────►   │                       │
     │  SET product:123 newData    │                       │
     │  ────┐                      │                       │
     │      │ update cache         │                       │
     │  ◄───┘                      │                       │
     │                             │  UPDATE products ...  │
     │                             │ ───────────────►     │
     │                             │                       │
     │  OK                         │                       │
     │ ◄──────────────────────────-│                       │

Write-Behind (Write-Back)
  Application                    Cache                  Database
     │                             │                       │
     │  UPDATE product SET name    │                       │
     │ ────────────────────────►   │                       │
     │  SET product:123 newData    │                       │
     │  ────┐                      │                       │
     │      │ update cache         │                       │
     │  ◄───┘                      │                       │
     │  OK (fast!)                 │                       │
     │ ◄──────────────────────────-│                       │
     │                             │                       │
     │                             │  (async)              │
     │                             │  UPDATE products ...  │
     │                             │ ───────────────►     │
```

---

## How it Works

### Cache-Aside (Lazy Loading)

The application is responsible for both reading from and writing to the cache.

1. Application checks the cache for the requested key.
2. On a **cache hit**, the cached value is returned immediately — no database query.
3. On a **cache miss**, the application queries the database, stores the result in the cache with a TTL, and returns it.
4. On a **write**, the application updates the database and invalidates (deletes) the corresponding cache key. The next read will miss and re-fetch.

### Read-Through

A cache layer (Redis, CDN) sits between the application and the database and handles misses automatically:

1. Application always reads from the cache.
2. On a miss, the cache itself queries the database (or loads from a configured source), populates itself, and returns the value.
3. The application never directly touches the database for reads.

### Write-Through

Every write goes through the cache to the database synchronously:

1. Application sends the write to the cache.
2. The cache updates its in-memory copy.
3. The cache synchronously writes the data to the database.
4. The application receives acknowledgment only after both cache and database are updated.

### Write-Behind (Write-Back)

Writes go to the cache first and are asynchronously flushed to the database:

1. Application sends the write to the cache.
2. The cache updates its in-memory copy immediately and acknowledges the write.
3. The cache asynchronously batches and writes the data to the database.
4. The application sees low write latency because it does not wait for the database.

### Cache Invalidation Strategies

| Strategy | How it Works | Pros | Cons |
|----------|-------------|------|------|
| **TTL (Time-To-Live)** | Cache entries expire after a fixed duration | Simple, automatic, no coordination | Stale data until expiry; hard to pick the right TTL |
| **Write-invalidate** | On write, delete the cache key | Data is fresh after next read | Cache miss storm on write-heavy keys |
| **Write-update** | On write, update the cache with the new value | No miss after write; reads always fresh | Write amplification; race conditions with concurrent writes |
| **LRU / LFU eviction** | Cache evicts least-recently/frequently used entries when full | Automatic memory management; hot data stays | Does not handle staleness — eviction is about capacity, not freshness |
| **Versioned keys** | Include a version or timestamp in the key (`product:123:v2`) | No stale reads; instant migration | Key management complexity; old keys accumulate |

---

## Strategies in Detail

### Cache-Aside (Most Common)

```typescript
async function getUser(id: string) {
  const key = `user:${id}`;

  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);

  const user = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  if (user) {
    await cache.setEx(key, 300, JSON.stringify(user)); // 5 min TTL
  }
  return user;
}

// On write, invalidate the cache — next read repopulates it
async function updateUser(id: string, data: Partial<User>) {
  await db.query('UPDATE users SET name = ? WHERE id = ?', [data.name, id]);
  await cache.del(`user:${id}`); // invalidate, do not write-through
}
```

### Write-Through Cache

```typescript
async function updateProduct(id: string, data: Partial<Product>) {
  const key = `product:${id}`;
  const updated = { ...data, updatedAt: new Date() };

  // Update cache first
  await cache.set(key, JSON.stringify(updated));

  // Then update database synchronously
  await db.query('UPDATE products SET ? WHERE id = ?', [data, id]);
}
```

### Write-Behind Cache (Write-Back)

```typescript
class WriteBehindCache {
  private queue: Map<string, any> = new Map();
  private flushInterval: NodeJS.Timeout;

  constructor(private db: Pool, flushMs: number = 1000) {
    this.flushInterval = setInterval(() => this.flush(), flushMs);
  }

  async set(key: string, value: any) {
    // Update cache immediately
    await cache.set(key, JSON.stringify(value));
    // Queue the write for async flush
    this.queue.set(key, value);
  }

  private async flush() {
    if (this.queue.size === 0) return;
    const batch = [...this.queue.entries()];
    this.queue.clear();

    // Batch write to database
    for (const [key, value] of batch) {
      const id = key.split(':')[1];
      await this.db.query('UPDATE products SET ? WHERE id = ?', [value, id]);
    }
  }

  // On shutdown, flush remaining writes
  async drain() {
    clearInterval(this.flushInterval);
    await this.flush();
  }
}
```

### Cache Stampede Prevention

When a popular cache key expires, many requests may simultaneously miss and hammer the database. Solutions:

```typescript
// Solution 1: Mutex lock around cache miss
async function getProduct(id: string) {
  const key = `product:${id}`;
  const cached = await cache.get(key);
  if (cached) return JSON.parse(cached);

  // Only one request populates the cache
  const lockKey = `lock:product:${id}`;
  const lock = await cache.setNX(lockKey, '1', { ttl: 5 });

  if (lock) {
    try {
      const product = await db.query('SELECT * FROM products WHERE id = ?', [id]);
      await cache.setEx(key, 3600, JSON.stringify(product));
      return product;
    } finally {
      await cache.del(lockKey);
    }
  }

  // Other requests wait briefly, then retry the cache
  await sleep(50);
  return getProduct(id);
}

// Solution 2: Stale-while-revalidate (serve stale, refresh in background)
async function getPosts() {
  const key = 'posts:feed';
  const cached = await cache.get(key);

  if (cached) {
    const parsed = JSON.parse(cached);
    // Serve stale data but trigger background refresh
    if (parsed.generatedAt < Date.now() - 30_000) {
      refreshFeedInBackground(); // async, non-blocking
    }
    return parsed.data;
  }

  return refreshFeed(); // cache miss — wait for fresh data
}
```

### Multi-Level Cache (L1 + L2)

```text
Application
    │
    ├── L1: In-memory (Map, LRU cache) — nanoseconds, local to process
    │     size: small (100 MB), eviction: LRU
    │     good for: hot data accessed by every request
    │
    ├── L2: Redis — milliseconds, shared across instances
    │     size: large (10 GB), eviction: LRU + TTL
    │     good for: session data, user profiles, product catalog
    │
    └── L3: Database — tens of milliseconds, source of truth
```

```typescript
import { LRUCache } from 'lru-cache';

const l1 = new LRUCache<string, any>({
  max: 1000,            // max 1000 entries
  ttl: 60_000,          // 1 minute TTL
});

async function getProduct(id: string) {
  // L1: in-memory (fastest)
  const fromL1 = l1.get(id);
  if (fromL1) return fromL1;

  // L2: Redis (shared across instances)
  const key = `product:${id}`;
  const fromL2 = await cache.get(key);
  if (fromL2) {
    const parsed = JSON.parse(fromL2);
    l1.set(id, parsed); // populate L1
    return parsed;
  }

  // L3: database (source of truth)
  const product = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  if (product) {
    await cache.setEx(key, 3600, JSON.stringify(product));
    l1.set(id, product);
  }
  return product;
}
```

---

## Advantages

- **Latency reduction** — cache hits (1-5ms Redis) vs database queries (10-100ms) — 10-100x faster
- **Database load reduction** — fewer queries means lower CPU, IOPS, and connection pool pressure
- **Cost savings** — fewer database reads may allow a smaller instance type
- **Throughput improvement** — the same database can serve more users with caching
- **Availability** — if the database is degraded, the cache can continue serving stale data (graceful degradation)
- **Geographic distribution** — CDN caches serve static content from edge locations close to users

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Stale data** | Cache returns data that differs from the database | Appropriate TTL; write-invalidate pattern |
| **Cache miss storm** | Popular key expires; all requests hit the database simultaneously | Mutex locks; stale-while-revalidate; proactive refresh |
| **Cache poisoning** | Malicious or incorrect data written to the cache | Validate data before caching; never trust cache for auth decisions |
| **Memory cost** | Redis instances cost money; in-memory caches consume RAM | Set memory limits; LRU eviction; monitor hit ratio |
| **Complexity** | Cache invalidation, consistency, serialisation all add code | Use established patterns (cache-aside, write-through) |
| **Cold start** | Empty cache on deployment — all requests hit the database | Pre-warming; gradual ramp-up; circuit breakers on DB |

---

## When to Use

- **Expensive queries** — complex JOINs, aggregations, full-text searches that run repeatedly
- **Hot data** — the same data read by many users (product catalog, configuration, user profiles)
- **Read-heavy workloads** — dashboards, public APIs, content sites where reads dominate writes
- **Cross-service data** — shared reference data (country list, currency rates) that every service needs
- **Rate-limited external APIs** — cache responses from third-party APIs to stay within rate limits

---

## When NOT to Use

- **Data that changes every write** — counters, leaderboards, real-time stock prices (cache invalidates too frequently)
- **Write-heavy workloads** — every write invalidates the cache, making it ineffective
- **Strong consistency requirements** — cache is eventually consistent by nature; use the database directly if stale data is unacceptable
- **Small datasets** — if the entire dataset fits in the database buffer pool, caching adds complexity without benefit
- **Rarely accessed data** — caching data that is rarely read wastes memory

---

## Related Concepts

- [Consistent Hashing](consistent-hashing.md) — how Redis Cluster and Memcached distribute cache keys across nodes
- [Rate Limiting](rate-limiting.md) — rate limiters often use Redis with TTL-based sliding windows
- [Distributed Lock](distributed-lock.md) — Redis SET NX for cache stampede prevention
- [Database Concurrency Control](database-concurrency-control.md) — caching does not replace concurrency control; writes still need transactions
- [Backpressure](backpressure.md) — cache miss storms should be metered with backpressure to protect the database
- [Circuit Breaker](circuit-breaker.md) — if the cache is down, fall through to the database; if the database is down, serve stale cache
- [MySQL Scaling](mysql-scaling.md) — caching is a key stage before sharding in the MySQL scaling progression
- [Replication](replication.md) — replicas are another form of read scaling; caching and replicas are complementary
- CDN
- Redis
- Memcached
- Varnish

---

## Key Takeaways

> Cache-aside (lazy loading) is the most common and safest caching strategy — check cache first, populate on miss, invalidate on write. TTL-based expiration provides automatic freshness with no coordination overhead. Pair caching with a write-invalidation strategy to keep the cache consistent. For hot keys that expire, use mutex locks or stale-while-revalidate to prevent cache stampedes. Multi-level caching (L1 in-memory + L2 Redis) provides the best latency while keeping the shared cache manageable. Monitor cache hit ratio — values below 80% indicate the cache strategy or TTL needs adjustment. Caching does not replace database concurrency control — it reduces read pressure but does not solve write conflicts.
