# Distributed Lock

> A mechanism that prevents multiple processes or services from accessing the same resource concurrently, ensuring mutual exclusion across a network.

---

## What is it?

A **Distributed Lock** provides exclusive access to a shared resource (file, database row, API endpoint) across multiple services or processes. Unlike single-process locking (`Mutex`), the lock state is stored in a shared backend — typically Redis, PostgreSQL, or ZooKeeper — so all participants can see and respect it.

The lock must satisfy three properties:

| Property | Meaning |
|----------|---------|
| **Safety** | No two processes ever hold the same lock simultaneously |
| **Liveness** | A lock is eventually released even if the holder crashes (via TTL / lease) |
| **Fault tolerance** | The lock service itself tolerates failures without granting duplicate locks |

---

## Problem

In a [Distributed System](distributed-systems.md), multiple instances of the same service can process work concurrently. Without coordination:

- Two instances run the same scheduled job simultaneously — duplicate invoice generation, double billing.
- Two services try to update the same resource without [Database Concurrency Control](database-concurrency-control.md) — conflicting writes.
- A leader election scenario has no mechanism to ensure only one node acts as leader.
- A cron job runs on every replica instead of exactly one.

Database-level pessimistic locking (`SELECT ... FOR UPDATE`) only works when all participants share the same database. A distributed lock works across services, databases, and even data centres.

---

## Example

### Redis-Based Lock (Redlock with `ioredis`)

The `redlock` library implements the Redlock algorithm, which uses multiple Redis nodes for fault tolerance:

```typescript
import Redlock from 'redlock';
import IORedis from 'ioredis';

const redis = new IORedis({ host: 'redis-1.example.com' });
const redis2 = new IORedis({ host: 'redis-2.example.com' });
const redis3 = new IORedis({ host: 'redis-3.example.com' });

const redlock = new Redlock(
  [redis, redis2, redis3],
  {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
  }
);

async function processInvoice(invoiceId: string) {
  const lockKey = `lock:invoice:${invoiceId}`;
  const lock = await redlock.acquire([lockKey], 30_000); // TTL: 30s

  try {
    // Exclusive access — only one instance runs this
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (invoice.status === 'paid') return;

    await chargeCustomer(invoice);
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'paid' } });
  } finally {
    // Always release — even if the operation throws
    await lock.release();
  }
}
```

### PostgreSQL Advisory Lock

PostgreSQL provides session-scoped advisory locks that work across processes:

```typescript
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function tryLock(lockId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    // pg_try_advisory_lock returns true if the lock was acquired
    const result = await client.query('SELECT pg_try_advisory_lock($1)', [lockId]);
    if (result.rows[0].pg_try_advisory_lock) {
      return true;
    }
    return false;
  } finally {
    client.release();
  }
}

async function releaseLock(lockId: number) {
  await pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
}
```

### Simple Redis Lock (SET NX EX)

For basic use cases, a single Redis `SET NX` command is sufficient (single Redis node, no Redlock):

```typescript
import IORedis from 'ioredis';

const redis = new IORedis({ host: process.env.REDIS_HOST });

async function acquireLock(key: string, ttlMs: number): Promise<boolean> {
  const result = await redis.set(key, 'locked', 'PX', ttlMs, 'NX');
  return result === 'OK';
}

async function releaseLock(key: string) {
  // Only delete if we still hold the lock (compare value to avoid releasing another owner's lock)
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, key, 'locked');
}
```

---

## Architecture / Flow

```text
Service A                      Redis (Lock Store)             Service B
    │                                │                            │
    │  ACQUIRE lock:invoice:123      │                            │
    │──────────────────────────────►│                            │
    │                                │  SET NX EX 30              │
    │                                │  (key created)             │
    │◄──────────────────────────────│  OK                         │
    │                                │                            │
    │  Process invoice (exclusive)   │                            │
    │                                │                            │
    │                                │       ACQUIRE lock:invoice:123
    │                                │◄───────────────────────────│
    │                                │       (key exists — fail)  │
    │                                │───────────────────────────►│  Lock not acquired
    │                                │                            │  (skip or retry)
    │  RELEASE lock                  │                            │
    │──────────────────────────────►│                            │
    │                                │  DEL key                   │
    │                                │                            │
    │                                │       ACQUIRE lock:invoice:123
    │                                │◄───────────────────────────│
    │                                │       (key deleted — OK)   │
    │                                │───────────────────────────►│  Lock acquired
```

---

## How it Works

1. A process creates a lock by writing a unique key-value pair to a shared store (Redis, database, ZooKeeper) with a TTL — `SET key value NX EX 30`.
2. If the key already exists, the `NX` flag causes the write to fail — another process holds the lock.
3. The process performs its critical section (exclusive work) while holding the lock.
4. The process releases the lock by deleting the key. A Lua script ensures only the original owner can delete it (safety against accidental release).
5. If the process crashes before releasing, the TTL expires and the lock is automatically freed (liveness).
6. If a lock expires while the process is still working, a heartbeat or lease extension mechanism can refresh the TTL.

---

## Advantages

- **Safe coordination** — prevents duplicate processing of the same work across service instances
- **No code changes to the resource** — the lock is external, not embedded in the resource itself
- **Flexible backend** — works with Redis, PostgreSQL, ZooKeeper, etcd, or any consistent store
- **TTL-based safety** — crashed holders do not block the resource forever
- **Idempotency companion** — combining locks with [Idempotency](idempotency.md) provides strong guarantees

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **TTL tuning** — too short and the lock expires before work completes; too long and recovery is delayed | Requires accurate knowledge of critical section duration |
| **Redis failover** — a Redis leader fails after granting a lock but before replicating it; another node may grant the same lock | Redlock algorithm mitigates this with majority writes across multiple Redis nodes |
| **Performance overhead** — every lock acquisition and release adds network latency | Avoid fine-grained locking in hot paths |
| **Deadlock potential** — forgetting to release a lock or holding it across async boundaries | Always use `try/finally` to release |
| **Complexity** — lock management, TTL renewal, fencing tokens, and retry logic add code | Overkill for operations that can tolerate occasional conflicts |

---

## When to Use

- Scheduled jobs that must run on exactly one instance (cron replacements, batch processing)
- Leader election — ensuring one node acts as the coordinator
- Resource allocation — assigning work items from a shared pool across workers
- Preventing duplicate processing of external webhooks or events where idempotency is insufficient alone

---

## When NOT to Use

- Operations that can use optimistic or pessimistic locking within a single database (see [Database Concurrency Control](database-concurrency-control.md))
- Operations where [Idempotency](idempotency.md) alone solves the duplicate problem
- High-throughput operations where lock contention becomes the bottleneck
- Systems where the lock backend (Redis, DB) would become a single point of failure

---

## Related Concepts

- [Database Concurrency Control](database-concurrency-control.md) — single-database locking is simpler when all participants share one database
- [Idempotency](idempotency.md) — for many cases, idempotent processing removes the need for distributed locking
- [Distributed Systems](distributed-systems.md) — locks are a coordination primitive in distributed architectures
- [Concurrency vs Parallelism](concurrency-vs-parallelism.md) — distributed locks control concurrency across processes, not within a single CPU
- [Distributed Transactions](distributed-transactions.md) — locks can be used as a building block for transaction coordination
- Redlock Algorithm
- Fencing Token
- ZooKeeper / etcd
- Lease / Heartbeat

---

## Key Takeaways

> A Distributed Lock provides mutual exclusion across services via a shared backend (Redis, PostgreSQL). It ensures that only one instance processes a resource at a time, with TTL-based safety against crashes. Always pair locks with `try/finally` release and consider whether [Idempotency](idempotency.md) alone would suffice — locking adds operational complexity that is not always justified.
