# ACID Compliance

> Atomicity, Consistency, Isolation, Durability — the four properties that guarantee reliable processing of database transactions.

---

## What is it?

ACID is a set of properties that guarantee database transactions are processed reliably. A **transaction** is a logical unit of work — one or more operations that should succeed or fail as a single unit. ACID ensures that concurrent transactions do not corrupt data, that system crashes do not lose committed work, and that database invariants are preserved.

ACID is the foundation of relational databases (PostgreSQL, MySQL, SQLite) and is emulated to varying degrees by NoSQL databases (MongoDB, DynamoDB).

---

## The Four Properties

### Atomicity

All operations in a transaction complete successfully, or none of them do. If any operation fails partway through, the database rolls back any partial changes as if the transaction never started.

**What it prevents:** A funds transfer debits Account A but the system crashes before crediting Account B — the money disappears.

**How it works:** The database writes changes to a **write-ahead log (WAL)** before applying them to the data pages. If the transaction fails or the system crashes, the WAL is discarded and the partial changes are never applied.

```sql
BEGIN;

UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- If either UPDATE fails, both are rolled back
COMMIT;
```

### Consistency

A transaction brings the database from one valid state to another valid state. All defined rules — constraints, cascades, triggers, and application-level invariants — are preserved before and after the transaction.

**What it prevents:** A transaction sets an order's `total` to NULL, violating a NOT NULL constraint, and the database silently accepts it.

**How it works:** The database enforces constraints (PRIMARY KEY, FOREIGN KEY, CHECK, UNIQUE, NOT NULL) at the end of each transaction. If any constraint is violated, the entire transaction is rolled back.

```typescript
// Application-level consistency — total must equal sum of line items
await prisma.$transaction(async (tx) => {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // If this trigger fails, the transaction rolls back both updates
  await tx.order.update({
    where: { id: orderId },
    data: { total, updatedAt: new Date() },
  });
});
```

### Isolation

Concurrent transactions execute as if they were run sequentially. Each transaction sees a consistent snapshot of the database, unaware of other concurrently running transactions.

**Isolation is a spectrum** — databases offer levels that trade strictness for performance:

| Level | Dirty Read | Non-Repeatable Read | Phantom Read | How It Works |
|-------|-----------|---------------------|--------------|--------------|
| **Read Uncommitted** | Possible | Possible | Possible | No isolation — reads see uncommitted changes from other transactions |
| **Read Committed** (default in PostgreSQL, SQL Server) | Prevented | Possible | Possible | Reads only see committed data; each statement gets a fresh snapshot |
| **Repeatable Read** (default in MySQL InnoDB) | Prevented | Prevented | Possible | Same snapshot for all reads in the transaction |
| **Serializable** | Prevented | Prevented | Prevented | Transactions execute as if one at a time; highest isolation |

**Isolation phenomena:**

- **Dirty read** — Transaction B reads data written by an uncommitted transaction A. If A rolls back, B has read invalid data.
- **Non-repeatable read** — Transaction A reads a row. Transaction B updates and commits that row. Transaction A re-reads the row and sees a different value.
- **Phantom read** — Transaction A runs a query. Transaction B inserts a row matching that query and commits. Transaction A re-runs the query and sees a new phantom row.

```typescript
// PostgreSQL default — Read Committed
// Each SELECT sees only committed data at that moment
const prisma = new PrismaClient();

await prisma.$transaction(async (tx) => {
  // All reads here use the same snapshot (Repeatable Read equivalent in PostgreSQL)
  const user = await tx.user.findUnique({ where: { id } });
  const orders = await tx.order.findMany({ where: { userId: user.id } });

  // If another transaction commits between these two queries,
  // Read Committed might see different data. In Prisma $transaction,
  // PostgreSQL uses Repeatable Read isolation.
});
```

**For a deeper exploration of concurrency control mechanisms, see [Database Concurrency Control](database-concurrency-control.md).**

### Durability

Once a transaction is committed, its changes persist even if the system crashes immediately after. The data survives power loss, operating system crashes, and database restarts.

**How it works:** Before the database reports "COMMIT" to the client, it writes the transaction's changes to the **write-ahead log (WAL)** on disk. On recovery, the database replays the WAL to restore any committed transactions that were not yet applied to the data files.

**Durability can be relaxed** — `synchronous_commit = off` in PostgreSQL trades durability for speed (the database acknowledges commit before the WAL reaches disk).

```typescript
// Durability by default — COMMIT waits for WAL flush to disk
await prisma.$transaction(async (tx) => {
  await tx.user.update({ where: { id }, data: { name } });
});

// Relaxed durability — faster, but at risk on crash
await prisma.$executeRawUnsafe('SET synchronous_commit TO off');
await prisma.$transaction(async (tx) => {
  await tx.user.update({ where: { id }, data: { name } });
});
```

---

## Example

A typical ACID transaction in Node.js with PostgreSQL:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function placeOrder(userId: string, productId: string, quantity: number) {
  await prisma.$transaction(async (tx) => {
    // 1. Atomicity — all or nothing
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
    });

    if (product.stock < quantity) {
      throw new Error('Insufficient stock');
    }

    // 2. Consistency — invariants enforced
    await tx.product.update({
      where: { id: productId },
      data: { stock: { decrement: quantity } },
    });

    const order = await tx.order.create({
      data: { userId, productId, quantity, total: product.price * quantity },
    });

    // 3. Isolation — no other transaction sees intermediate state
    // 4. Durability — on COMMIT, changes are written to WAL
  });
}
```

---

## Architecture

```
Transaction Flow
   BEGIN
     │
     ▼
  Write changes to WAL (write-ahead log)
     │
     ▼
  Apply changes to data pages (in memory)
     │
     ▼
  Validate constraints (Consistency check)
     │
     ▼
  Flush WAL to disk (Durability)
     │
     ▼
  COMMIT (report success to client)
     │
     ▼
  On crash: replay WAL to restore committed changes
```

---

## ACID vs BASE

| Property | ACID | BASE |
|----------|------|------|
| Philosophy | Consistency first | Availability first |
| Atomicity | All-or-nothing | Eventual consistency |
| Consistency | Strong, enforced by DB | Weak, application-managed |
| Isolation | Serializable or repeatable reads | Read uncommitted or relaxed |
| Durability | WAL, fsync, replication | Replication, eventual durable |
| Typical databases | PostgreSQL, MySQL, SQLite | Cassandra, MongoDB, DynamoDB |
| Use cases | Financial, inventory, orders | Analytics, logging, social feeds |

BASE (Basically Available, Soft state, Eventual consistency) trades ACID guarantees for availability and partition tolerance under the CAP theorem. For a full analysis of the trade-off, see [CAP Theorem](cap-theorem.md) and [Consistency Models](consistency-models.md).

---

## Advantages

- **Data integrity** — constraints, rollbacks, and isolation prevent corruption
- **Developer confidence** — transactions simplify error handling; operations either succeed fully or have no effect
- **Recoverability** — WAL ensures no committed data is lost, even on crash
- **Concurrency safety** — isolation levels prevent race conditions at the database level
- **Well-understood** — decades of proven implementation in PostgreSQL, MySQL, and other relational databases

---

## Trade-offs

- **Performance** — strict isolation, WAL flushing, and constraint checking add overhead compared to eventual consistency
- **Scalability** — ACID transactions are hard to scale horizontally; distributed ACID requires coordination (2PC, Paxos)
- **Lock contention** — serializable isolation reduces throughput under high concurrency
- **Operational cost** — maintaining ACID at scale requires careful schema design, indexing, and transaction sizing

---

## When to Use

- **Financial systems** — payments, ledgers, invoices where all-or-nothing is critical
- **E-commerce** — inventory deduction, order creation where overselling must be prevented
- **Any system with invariants** — unique constraints, referential integrity, application-level consistency rules
- **Systems that require audit** — committed transactions leave a durable record

---

## When NOT to Use

- **High-throughput analytics** — relaxed consistency is acceptable when absolute accuracy per event is not required
- **Logging / metrics** — dropping a single log line is acceptable; ACID overhead is not justified
- **Session state** — lost sessions are tolerable; ACID guarantees are unnecessary
- **Leaderboards** — slight inaccuracy from eventual consistency is acceptable
- **When the database does not support it** — some NoSQL databases do not provide ACID across documents (check the specific database's transaction documentation)

---

## Related Concepts

- [Database Concurrency Control](database-concurrency-control.md) — isolation levels, optimistic and pessimistic locking, MVCC
- [CAP Theorem](cap-theorem.md) — ACID trades availability for consistency; CAP explains the fundamental trade-off
- [Consistency Models](consistency-models.md) — strong, eventual, causal consistency and how they relate to isolation
- [Distributed Transactions](distributed-transactions.md) — ACID across multiple databases via Two-Phase Commit
- [Database Migrations](database-migrations.md) — ACID applies to migration transactions; expand-migrate-contract respects atomicity
- [Eventual Consistency](handling-eventual-consistency.md) — strategies for working without ACID guarantees

---

## Key Takeaways

> ACID guarantees that database transactions are reliable: Atomicity (all or nothing), Consistency (invariants preserved), Isolation (concurrent transactions do not interfere), Durability (committed data survives crashes). Isolation is a spectrum — choose the strictest level that meets your requirements and accept the performance trade-off. ACID is non-negotiable for financial and inventory systems where data integrity is critical. For systems where availability outweighs consistency, BASE and eventual consistency are more appropriate. Understanding ACID helps you decide when to use a relational database and when a NoSQL alternative is a better fit.
