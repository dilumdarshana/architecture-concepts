# Database Concurrency Control

> Mechanisms for managing simultaneous data access to prevent race conditions, lost updates, and inconsistent reads while preserving performance.

---

## What is it?

Database concurrency control governs how multiple operations access shared data simultaneously without compromising correctness. The four main mechanisms — **transactions**, **atomic operations**, **pessimistic locking**, and **optimistic locking** — each offer different trade-offs between safety, throughput, and complexity. The **ACID** properties define the guarantees transactions provide, while **lock granularity** (row-level, page-level, table-level) determines the scope of locked resources.

---

## ACID Properties

ACID is the set of guarantees that a reliable transaction must provide:

| Property | Meaning |
|----------|---------|
| **Atomicity** | All operations in a transaction succeed or all roll back. No partial commits. |
| **Consistency** | A transaction brings the database from one valid state to another, preserving all defined rules (constraints, cascades, triggers). |
| **Isolation** | Concurrent transactions execute as if they were serialized. Intermediate states are invisible to other transactions. |
| **Durability** | Once committed, the data survives system failures (power loss, crash). |

For a detailed exploration of each property, including isolation phenomena and ACID vs BASE, see [ACID Compliance](acid-compliance.md). In practice, databases relax Isolation for performance — the four standard **isolation levels** balance safety against throughput:

| Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|-------|-----------|---------------------|--------------|
| Read Uncommitted | Possible | Possible | Possible |
| Read Committed | Prevented | Possible | Possible |
| Repeatable Read | Prevented | Prevented | Possible |
| Serializable | Prevented | Prevented | Prevented |

PostgreSQL defaults to **Read Committed**. Prisma transactions run at the database's default isolation level unless explicitly overridden:

```typescript
await prisma.$transaction(
  async (tx) => { /* ... */ },
  { isolationLevel: 'Serializable' }
);
```

---

## Problem

Without concurrency control, concurrent access causes:

- **Lost updates** — two reads of the same row, then both write; one write is silently overwritten.
- **Dirty reads** — reading uncommitted data that later rolls back.
- **Non-repeatable reads** — reading the same row twice in a transaction and getting different values.
- **Phantom reads** — a query returns different rows within the same transaction because another transaction inserted data.
- **Race conditions** — e.g. two requests deducting from inventory at the same time, both seeing `stock = 5`, both writing `stock = 4` instead of `stock = 3`.

---

## Example

### Transactions

A Prisma `$transaction` ensures atomicity: either all writes succeed or all roll back.

```typescript
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({
    data: { customerId, total, status: 'confirmed' }
  });
  await tx.inventory.update({
    where: { productId },
    data: { stock: { decrement: 1 } }
  });
  return order;
});
```

### Atomic Operations

Database-level atomic operations prevent race conditions without locking:

```typescript
// Safe — database atomically decrements, no read-then-write race
await prisma.inventory.update({
  where: { productId, stock: { gte: 1 } },
  data: { stock: { decrement: 1 } }
});
```

Versus the unsafe read-then-write pattern:

```typescript
// Unsafe — two concurrent requests can both read stock=1 and both proceed
const item = await prisma.inventory.findUnique({ where: { productId } });
if (item.stock >= 1) {
  await prisma.inventory.update({
    where: { productId },
    data: { stock: item.stock - 1 }  // lost update!
  });
}
```

### Pessimistic Locking

Locks the row for the duration of a transaction, blocking others from modifying it:

```typescript
await prisma.$transaction(async (tx) => {
  // SELECT ... FOR UPDATE — locks the row
  const item = await tx.$queryRawUnsafe(
    'SELECT stock FROM inventory WHERE id = $1 FOR UPDATE',
    productId
  );
  if (item[0].stock < quantity) throw new Error('Out of stock');

  await tx.inventory.update({
    where: { id: productId },
    data: { stock: { decrement: quantity } }
  });
});
```

### Optimistic Locking

Uses a version number to detect conflicts at write time instead of locking:

```typescript
async function reserveInventory(
  productId: string,
  quantity: number,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 1. Read the current row (no lock held)
    const item = await prisma.inventory.findUnique({
      where: { id: productId }
    });

    if (!item || item.stock < quantity) {
      throw new Error('Out of stock');
    }

    // 2. Attempt the update with a version check
    const result = await prisma.inventory.updateMany({
      where: {
        id: productId,
        version: item.version,       // <-- optimistic lock
        stock: { gte: quantity },
      },
      data: {
        stock: { decrement: quantity },
        version: { increment: 1 },
      },
    });

    // 3. If zero rows matched, version changed — retry
    if (result.count > 0) return;

    if (attempt === maxRetries) {
      throw new Error('Max retries exceeded — try again later');
    }

    console.log(`Conflict on ${productId}, retry ${attempt}/${maxRetries}`);
  }
}
```

`prisma.updateMany` with a `where` clause that includes the version returns `{ count: 0 }` when no row matches. For single-record updates, `prisma.update` throws `PrismaClientKnownRequestError` with code `P2025` ("Record to update not found") instead — catch it and retry:

```typescript
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client.js';

try {
  await prisma.inventory.update({
    where: { id: productId, version: expectedVersion },
    data: { stock: { decrement: quantity }, version: { increment: 1 } },
  });
} catch (err) {
  if (err instanceof PrismaClientKnownRequestError && err.code === 'P2025') {
    // Version mismatch — another request already changed the row
    return await reserveInventory(productId, quantity);
  }
  throw err;
}
```

---

## Architecture / Flow

```text
Request A                          Request B
    │                                  │
    │  BEGIN TXN                       │  BEGIN TXN
    │  Read stock (version=1)          │  Read stock (version=1)
    │                                  │
    ├── Optimistic Locking ────────────┤
    │                                  │
    │  UPDATE ... version=1 → 2        │  UPDATE ... version=1 → 2
    │  (succeeds)                      │  (fails — version mismatch)
    │                                  │
    │  COMMIT                          │  ROLLBACK / retry
    ▼                                  ▼

Request A                          Request B
    │                                  │
    │  BEGIN TXN                       │
    │  SELECT ... FOR UPDATE           │
    │  (acquires lock)                 │
    │                                  │  BEGIN TXN
    │                                  │  SELECT ... FOR UPDATE
    │  │                               │  (BLOCKED — waiting for A)
    │  Update stock                    │
    │  COMMIT (releases lock)          │
    │                                  │  (acquires lock, proceeds)
    ▼                                  ▼
```

### Lock Granularity

Databases lock resources at different levels of granularity. The choice affects concurrency and overhead:

| Granularity | Scope | Example | Concurrency | Overhead |
|-------------|-------|---------|-------------|----------|
| **Row-Level** | Single row in a table | `UPDATE inventory SET stock = ... WHERE id = 5` | Highest — other rows in the same table remain accessible | Higher — database must track many individual locks |
| **Page-Level** | Fixed-size block of rows (typically 4-16 KB) | Multiple rows stored on the same physical page | Medium — locking one row can block others on the same page | Medium — fewer lock entries to manage |
| **Table-Level** | Entire table | `LOCK TABLE inventory IN EXCLUSIVE MODE` | Lowest — blocks all concurrent access to the table | Lowest — single lock for the whole table |

PostgreSQL uses **row-level** locking by default for DML and falls back to table-level locks for certain DDL operations (e.g. `ALTER TABLE`). Row-level locks are the right choice for most application code — only escalate when bulk operations need the efficiency of coarser locks.

```sql
-- Row-level: only the matched rows are locked
SELECT * FROM inventory WHERE id = 5 FOR UPDATE;

-- Table-level: blocks all writes to the entire table
LOCK TABLE inventory IN EXCLUSIVE MODE;
```

---

## How it Works

### Transactions

1. Begin a transaction at the database connection level.
2. Execute multiple read/write operations within the transaction scope.
3. On commit, the database ensures all changes are persisted atomically.
4. On rollback (error or explicit abort), all changes are discarded.
5. The database uses its internal concurrency control (MVCC, locking) to isolate concurrent transactions.

### Atomic Operations

1. Application issues a single atomic statement (e.g. `UPDATE ... SET stock = stock - 1`).
2. The database acquires a short-lived lock on the row during the statement execution.
3. The operation completes without a separate read-then-write window.
4. Lock is released immediately after the statement, not held until transaction end.

### Pessimistic Locking

1. Transaction A issues `SELECT ... FOR UPDATE`, acquiring a row-level lock.
2. The database blocks other transactions from acquiring conflicting locks on the same row.
3. Transaction A performs its read, computes, and writes.
4. Transaction A commits or rolls back, releasing the lock.
5. Transaction B, which was blocked, now acquires the lock and proceeds.

### Optimistic Locking

1. Transaction A reads the row, capturing the current version number.
2. Transaction A performs its computation (no lock held).
3. Transaction A issues an update with `WHERE version = captured_version`.
4. The database checks the condition: if the version matches, the update succeeds and version increments.
5. If another transaction (B) already updated the row, the version does not match — the update affects zero rows.
6. Transaction A detects zero rows updated and retries the entire operation.

---

## Advantages

| Mechanism | Advantages |
|-----------|------------|
| **Transactions** | Atomic multi-operation commits; rollback on failure; isolation from concurrent work |
| **Atomic Operations** | No separate read/write gap; no lock held across multiple statements; highest throughput for simple mutations |
| **Pessimistic Locking** | Guaranteed success once lock acquired; simple mental model; prevents all conflicts proactively |
| **Optimistic Locking** | No locks held; high read throughput; scales well under low-contention workloads; no deadlock risk |

---

## Trade-offs

| Mechanism | Trade-offs |
|-----------|------------|
| **Transactions** | Holding transactions open too long increases contention; distributed transactions add coordination overhead |
| **Atomic Operations** | Limited to single-statement operations; cannot handle multi-step business logic |
| **Pessimistic Locking** | Reduced concurrency under contention; deadlock risk (requires deadlock detection or lock ordering); connection pool exhaustion if locks held too long |
| **Optimistic Locking** | High retry overhead under contention; not suitable for hot rows; client must implement retry logic; phantom writes still possible without versioning |

---

## When to Use

| Mechanism | When to Use |
|-----------|-------------|
| **Transactions** | Any multi-step write that must be atomic — order creation, fund transfer, inventory + order write |
| **Atomic Operations** | Simple counters, stock decrements, balance updates — anything expressible as a single `UPDATE` |
| **Pessimistic Locking** | High-contention writes where conflict is expected — flash sale inventory, last-seat booking, ledger journal entries |

### When to use SELECT FOR UPDATE

`SELECT ... FOR UPDATE` is the SQL statement that acquires a pessimistic row-level lock. Use it when:

- **Read-modify-write cycles** — you read a value, compute a new value based on it, and write back. Without `FOR UPDATE`, two concurrent transactions can read the same value and produce a lost update.
- **Inventory reservation** — read current stock, check availability, then decrement. `FOR UPDATE` ensures no other transaction reads stale stock between your read and write.
- **Financial ledgers** — read account balance, validate sufficient funds, then withdraw. The lock prevents concurrent withdrawals from seeing the same balance.
- **Queue claiming** — select the next unprocessed message and mark it in progress. `FOR UPDATE SKIP LOCKED` skips rows already locked by other consumers (see [Claim-Check Pattern](claim-check-pattern.md)).
- **Any read whose value must remain stable** until the transaction commits — for example, reading a configuration row before applying business rules that depend on that configuration.

```typescript
// Flash sale — reserve last item
await prisma.$transaction(async (tx) => {
  const item = await tx.$queryRawUnsafe<Array<{ stock: number }>>(
    'SELECT stock FROM inventory WHERE id = $1 FOR UPDATE',
    productId
  );
  if (item[0].stock < quantity) throw new Error('Out of stock');
  await tx.inventory.update({
    where: { id: productId },
    data: { stock: { decrement: quantity } }
  });
});
```

**Queue claiming** is a common pattern where multiple workers poll for the next job. `FOR UPDATE SKIP LOCKED` prevents workers from fighting over the same row:

```typescript
// Worker claims the next unprocessed message
async function claimNextMessage(tx: Prisma.TransactionClient):
  Promise<OutboxMessage | null> {
  const rows = await tx.$queryRawUnsafe<OutboxMessage[]>(
    `SELECT * FROM outbox_messages
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`
  );
  return rows[0] ?? null;
}

// Polling loop
setInterval(async () => {
  await prisma.$transaction(async (tx) => {
    const msg = await claimNextMessage(tx);
    if (!msg) return;
    await tx.outboxMessage.update({
      where: { id: msg.id },
      data: { status: 'processing' }
    });
    // process msg...
  });
}, 1000);
```

Without `SKIP LOCKED`, multiple workers that poll simultaneously all block on the same unprocessed row, creating a thundering-herd problem. With `SKIP LOCKED`, each worker gets a different row (or `null` if none are available), and they never wait on each other.

**Do NOT use `SELECT FOR UPDATE` when:**

- The operation can be expressed as a single atomic `UPDATE` statement (e.g. `UPDATE inventory SET stock = stock - 1 WHERE stock >= 1`)
- Conflicts are rare — optimistic locking is simpler and has lower overhead
- The transaction would hold the lock for a long time (network calls, user input) — locks should span milliseconds, not seconds
- You only need to read data — read-only queries never need `FOR UPDATE`

### PostgreSQL Advisory Locks from Prisma

PostgreSQL offers application-defined **advisory locks** — lightweight mutexes identified by a 64-bit integer or two 32-bit integers. Unlike row-level locks, advisory locks are not tied to any table row. Use them for cross-instance coordination where no natural row exists to lock.

```typescript
// Session-level advisory lock (released on connection close or explicit unlock)
await prisma.$executeRawUnsafe(
  "SELECT pg_advisory_lock(hashtext($1))",
  'db-migration-lock'
);

try {
  // critical section — only one instance at a time
  await runMigration();
} finally {
  // Release lock so other instances can proceed
  await prisma.$executeRawUnsafe(
    "SELECT pg_advisory_unlock(hashtext($1))",
    'db-migration-lock'
  );
}
```

**Try-advisory-lock** (non-blocking variant) returns `true`/`false` instead of blocking:

```typescript
const locked: Array<{ locked: boolean }> = await prisma.$queryRawUnsafe(
  'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
  'job-scheduler-lock'
);

if (locked[0].locked) {
  try {
    await scheduleJobs();
  } finally {
    await prisma.$executeRawUnsafe(
      'SELECT pg_advisory_unlock(hashtext($1))',
      'job-scheduler-lock'
    );
  }
} else {
  console.log('Another instance already holds the lock — skipping');
}
```

**When to use advisory locks:**
- **Distributed cron / job scheduling** — ensure only one instance runs a periodic job
- **Schema migrations** — prevent concurrent migrations in multi-instance deployments
- **Cache warming** — coordinate cache rebuilds without duplicate work
- **Non-table resources** — lock a logical resource (e.g. "user-import-process") without creating a row

**When NOT to use advisory locks:**

- **Row-level protection** — use `SELECT FOR UPDATE` instead; advisory locks have no relationship to table rows
- **Long-held locks** — advisory locks held across connection pool churn can leak (session-level locks survive until the connection closes or you explicitly unlock)
- **Portability** — advisory locks are a PostgreSQL-only feature

---

## When NOT to Use

- **Transactions** — avoid long-running transactions that hold locks or connections; avoid distributed transactions across databases (prefer [Saga Pattern](outbox-pattern.md) or [Outbox Pattern](outbox-pattern.md)).
- **Atomic Operations** — not suitable for multi-step business logic that requires validation before write.
- **Pessimistic Locking** — avoid in read-heavy workloads or when conflicts are rare; avoid when deadlock management is infeasible.
- **Optimistic Locking** — avoid when contention is high (retry overhead hurts throughput); avoid when you cannot tolerate any failed writes.

---

## Strategy Decision Table

| Pattern | How to Implement in Prisma | Best For | Worst For |
|---------|---------------------------|----------|-----------|
| **Atomic Operation** | `prisma.update({ where, data: { field: { increment/decrement } } })` with `where` guard | Single-field mutations (stock, counter) | Multi-step business logic |
| **Optimistic Locking** | `updateMany` with `version` in `where` + retry loop (or `update` + catch `P2025`) | Low-contention CRUD, profile edits | Hot rows, high write volume |
| **Pessimistic Locking** | `$queryRawUnsafe('SELECT ... FOR UPDATE')` inside `$transaction` | High-contention reservation (flash sales, booking) | Read-heavy workloads, long-held locks |
| **Queue Claiming** | `$queryRawUnsafe('SELECT ... FOR UPDATE SKIP LOCKED')` inside `$transaction` | Multi-worker job polling (outbox, task queue) | FIFO ordering (SKIP LOCKED skips locked rows regardless of order) |
| **Advisory Lock** | `$executeRawUnsafe('SELECT pg_advisory_lock(...)')` with try/finally unlock | Cross-instance coordination, cron scheduling | Row-level data protection, portable code |

---

## Related Concepts

- [ACID Compliance](acid-compliance.md) — foundational properties that concurrency control mechanisms implement
- [Concurrency vs Parallelism](concurrency-vs-parallelism.md) — database concurrency control operates at the data level, not the CPU level
- [Distributed Systems](distributed-systems.md) — distributed transactions and saga coordination
- [Outbox Pattern](outbox-pattern.md) — uses DB transactions for atomic event publishing
- MVCC (Multi-Version Concurrency Control)
- Isolation Levels (Read Committed, Repeatable Read, Serializable)
- Deadlock
- Two-Phase Commit

---

## Key Takeaways

> Database concurrency control prevents race conditions on shared data. ACID guarantees (Atomicity, Consistency, Isolation, Durability) define what reliable transactions provide. Row-level locking maximizes concurrency for most workloads; escalate to table-level only for bulk operations. Transactions provide atomic multi-step commits, atomic operations handle simple mutations without a read-write gap, pessimistic locking prevents conflicts proactively, and optimistic locking detects them at commit time.
