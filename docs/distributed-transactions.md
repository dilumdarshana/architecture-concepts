# Distributed Transactions

> A transaction that coordinates reads and writes across multiple independent databases or services, preserving atomicity and consistency beyond a single node.

---

## What is it?

A **distributed transaction** spans multiple databases, services, or message brokers within a single atomic unit. All participants must agree on the outcome — either all commit or all roll back. The most common protocol is **Two-Phase Commit (2PC)**, coordinated by a transaction manager.

Distributed transactions sit at the opposite end of the consistency spectrum from the [Saga Pattern](saga-pattern.md): they provide strong consistency (ACID) across services but at a high coordination cost.

---

## Problem

A monolith coordinates writes within a single database transaction. In a [Distributed System](distributed-systems.md), data is spread across separate databases owned by different services. Without distributed transactions:

- Placing an order requires writing to the Order DB, deducting from the Inventory DB, and charging in the Payment DB — if any step fails, the system is left in an inconsistent state.
- A message published to a broker may be consumed before the sending service's transaction is known to have committed or rolled back.
- Partial failures leave orphaned data across services that must be manually reconciled.

---

## Example

A funds transfer between two accounts in different databases:

```sql
-- Both databases must commit or both must roll back
BEGIN;

UPDATE accounts SET balance = balance - 100 WHERE id = 'A';
UPDATE accounts SET balance = balance + 100 WHERE id = 'B';

-- If the second UPDATE fails, the first must revert
COMMIT;
```

In a distributed transaction, this is coordinated via 2PC. The transaction manager orchestrates:

```typescript
// Pseudo-code for a 2PC coordinator
async function transferFunds(fromDb: string, toDb: string, amount: number) {
  const txId = generateTransactionId();

  // Phase 1: Prepare — each participant votes
  const [voteA, voteB] = await Promise.all([
    prepareDebit(txId, fromDb, amount),
    prepareCredit(txId, toDb, amount)
  ]);

  // Phase 2: Commit (if all voted yes) or Rollback (if any voted no)
  if (voteA === 'yes' && voteB === 'yes') {
    await Promise.all([commit(txId, fromDb), commit(txId, toDb)]);
  } else {
    await Promise.all([rollback(txId, fromDb), rollback(txId, toDb)]);
  }
}
```

In Node.js, the `@prisma/client` does not support distributed transactions across multiple databases. For cross-service coordination, applications typically use a distributed transaction coordinator (e.g. a dedicated transaction manager service or an XA-compliant broker):

```typescript
// Using a lightweight transaction coordinator
import { TransactionCoordinator } from './coordinator';

const coordinator = new TransactionCoordinator();

async function createOrderWithInventory() {
  const tx = coordinator.begin();

  try {
    // Phase 1 — prepare
    await tx.prepare('order-service', { orderId, amount });
    await tx.prepare('inventory-service', { productId, quantity: 1 });

    // Phase 2 — commit
    await tx.commit();
  } catch {
    // Phase 2 — rollback (compensate all prepared participants)
    await tx.rollback();
    throw new Error('Order creation failed');
  }
}
```

---

## Architecture / Flow

### Two-Phase Commit (2PC)

```text
           Transaction Manager (Coordinator)
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    Service A    Service B    Service C
    (Database)   (Database)   (Database)

    Phase 1 — Prepare (Vote)
    ─────────────────────────
    TM ── prepare? ───► A ──► yes ──► TM
    TM ── prepare? ───► B ──► yes ──► TM
    TM ── prepare? ───► C ──► no  ──► TM

    Phase 2 — Commit or Abort
    ─────────────────────────
    TM ── abort ──────► A (rollback)
    TM ── abort ──────► B (rollback)
    TM ── abort ──────► C (already rolled back)
```

### Coordination Strategies

| Strategy | Description | Consistency |
|----------|-------------|-------------|
| **Two-Phase Commit (2PC)** | Coordinator asks all participants to prepare; if all vote yes, commits; otherwise aborts | Strong (ACID) |
| **Three-Phase Commit (3PC)** | Adds a pre-commit phase to reduce blocking during coordinator failure | Strong, non-blocking |
| **XA Transactions** | Industry standard for 2PC across databases and message brokers; supported by PostgreSQL, MySQL, RabbitMQ | Strong |
| **TCC (Try-Confirm/Cancel)** | Each participant exposes three operations: Try (reserve), Confirm (commit), Cancel (release) | Strong with compensation |
| **Saga** | Orchestrates a sequence of local transactions with compensating actions on failure | Eventual |

---

## How it Works

1. Application begins a distributed transaction via the coordinator.
2. **Phase 1 (Prepare)** — The coordinator sends a `prepare` request to every participant. Each participant executes the transaction locally, acquires necessary locks, and votes "yes" (ready to commit) or "no" (cannot commit).
3. If any participant votes "no," the coordinator decides to abort — Phase 2 becomes a rollback.
4. If all participants vote "yes," the coordinator decides to commit — Phase 2 becomes a commit.
5. **Phase 2 (Commit/Abort)** — The coordinator sends the decision to all participants. Each participant either commits or rolls back and acknowledges.
6. The coordinator records the outcome in its transaction log for recovery in case of failure.

---

## Advantages

- **Strong consistency** — all participants agree on the outcome; no partial commits
- **Atomicity across boundaries** — coordinates services, databases, queues, and caches as a single unit
- **Familiar model** — same ACID guarantees developers already understand from single-database transactions
- **Correctness guarantee** — no manual compensating logic needed; the protocol handles failure

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Latency** | Prepare phase requires a round-trip to every participant; overall time = slowest participant |
| **Availability** | The coordinator is a single point of failure; if it crashes during 2PC, participants remain locked |
| **Scalability** | Lock contention increases with the number of participants; locks held during prepare phase |
| **Complexity** | Requires a transaction manager, distributed logging, and recovery procedures |
| **Heterogeneity** | Not all databases and message brokers support XA or 2PC |
| **Network cost** | Each participant must be reachable; network partitions force the coordinator to abort |

---

## When to Use

- Financial systems that require strong consistency across multiple databases (ledger + payments)
- Systems small enough that the operational cost of a coordinator is manageable
- Short-lived operations where locks are held for milliseconds, not seconds
- Environments where all participants support the same distributed transaction protocol (XA)

---

## When NOT to Use

- Most microservices architectures — prefer eventual consistency and the [Saga Pattern](saga-pattern.md) or [Outbox Pattern](outbox-pattern.md)
- High-throughput systems — 2PC's locking overhead and latency kill throughput
- Systems with heterogeneous data stores (e.g. PostgreSQL + MongoDB + S3), where XA support is unavailable
- Long-running transactions — holding locks for seconds or minutes causes contention and connection pool exhaustion
- Systems that must survive network partitions gracefully

---

## Related Concepts

- [Distributed Systems](distributed-systems.md) — distributed transactions are a coordination strategy for multi-service systems
- [Database Concurrency Control](database-concurrency-control.md) — ACID, locking, and isolation levels at the single-node level
- [Outbox Pattern](outbox-pattern.md) — alternative for event delivery that avoids distributed transactions
- [Saga Pattern](saga-pattern.md) — compensation-based alternative for long-running business workflows
- [CAP Theorem](cap-theorem.md)
- Two-Phase Commit (2PC)
- Three-Phase Commit (3PC)
- XA Standard
- TCC (Try-Confirm/Cancel)

---

## Key Takeaways

> Distributed transactions (2PC/XA) provide strong consistency across services at the cost of latency, availability, and operational complexity. They are rarely the right choice in modern microservices — Sagas, Outbox, and idempotency offer better availability and scalability with eventual consistency. Use distributed transactions only when strong cross-service consistency is non-negotiable and the coordination overhead is acceptable.
