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

### Two-Phase Commit (2PC) — Happy Path

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
    TM ── prepare? ───► C ──► yes ──► TM

    Phase 2 — Commit
    ─────────────────
    TM ── commit ────► A ──► ack ──► TM
    TM ── commit ────► B ──► ack ──► TM
    TM ── commit ────► C ──► ack ──► TM
```

### Two-Phase Commit (2PC) — Coordinator Crash (Blocking Problem)

```text
           Transaction Manager (Coordinator)
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    Service A    Service B    Service C
    (Database)   (Database)   (Database)

    Phase 1 — Prepare
    ─────────────────
    TM sends prepare to A, B, C
    A votes yes, B votes yes, C votes yes

    ⚠ Coordinator CRASHES after receiving all votes
      but before sending the commit decision

    Result:
    A: Prepared — holds locks, waiting for decision
    B: Prepared — holds locks, waiting for decision
    C: Prepared — holds locks, waiting for decision

    All three services are in-doubt.
    Locks are held until the coordinator recovers.
    This is why 2PC is a blocking protocol.
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
2. **Phase 1 (Prepare)** — The coordinator sends a `prepare` request to every participant. Each participant executes the transaction locally, acquires the necessary locks, writes the transaction to its own write-ahead log, and votes "yes" (ready to commit) or "no" (cannot commit). A "yes" vote is a promise: the participant **will** commit if told to.
3. If any participant votes "no," the coordinator decides to abort — Phase 2 sends `rollback` to all participants, which release locks and discard their prepared state.
4. If all participants vote "yes," the coordinator commits its decision to its own **transaction log** (durable storage), then sends `commit` to all participants in Phase 2.
5. Each participant commits, records the commit in its log, releases locks, and sends an acknowledgment back to the coordinator.
6. The coordinator marks the transaction as complete after receiving all acknowledgments.

### The Blocking Problem

2PC is a **blocking protocol** — once a participant votes "yes," it holds locks and blocks other work until the coordinator delivers a decision. If the coordinator crashes between Phase 1 and Phase 2 (after receiving all "yes" votes but before sending `commit`):

- Every participant is **in-doubt** — they have prepared the transaction but do not know the outcome.
- Locks remain held, blocking other transactions against the same data.
- No participant can unilaterally decide to commit or rollback without risking a split-brain outcome.
- The system is stuck until the coordinator recovers.

### Coordinator Recovery

The coordinator writes each state transition to a durable transaction log:

```text
Transaction T1: PREPARE_SENT    → written before Phase 1
                 ALL_VOTES_IN   → written after all votes received
                 COMMIT_DECIDED → written before Phase 2 commit
                 COMPLETED      → written after all acknowledgments
```

On recovery:
- If the last logged state is `PREPARE_SENT` — the coordinator knows Phase 1 was sent but has incomplete votes. It assumes the transaction failed and sends `rollback` to all participants.
- If the last logged state is `ALL_VOTES_IN` — the coordinator knows all votes were received. It checks the decision (commit or abort, persisted alongside this state) and resumes Phase 2.
- If the last logged state is `COMMIT_DECIDED` — the coordinator resends `commit` to all participants. Participants that already committed will acknowledge; participants still in-doubt will commit.

If the coordinator cannot recover (permanent failure), participants remain in-doubt indefinitely unless an administrator manually resolves them.

### Heuristic Decisions

When a participant remains in-doubt for too long and cannot reach the coordinator, it may make a **heuristic decision** — unilaterally committing or rolling back the transaction. This breaks atomicity: one participant may commit while another rolls back, leaving the system inconsistent. Heuristic decisions are a last resort, logged explicitly, and require manual reconciliation.

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

## 2PC in Practice

Distributed transactions via 2PC are rare in modern microservices, but they exist in specific infrastructure layers:

| Technology | How 2PC is Used |
|------------|-----------------|
| **PostgreSQL** | `PREPARE TRANSACTION` + `COMMIT PREPARED` / `ROLLBACK PREPARED` enables 2PC. Used in PgBouncer transaction pooling and some application-level coordinators. |
| **MySQL XA** | `XA START`, `XA END`, `XA PREPARE`, `XA COMMIT` / `XA ROLLBACK` — supports 2PC across multiple MySQL instances. Used with Distributed Transaction Coordinator (DTC) on Windows. |
| **RabbitMQ** | Supports XA transactions — publishes and acks are atomic across queues. Rarely used in practice due to high overhead. |
| **Apache Kafka** | Exactly-once semantics uses a 2PC-like protocol between the producer, broker, and transaction coordinator for atomic writes across partitions. |
| **JTA / Jakarta Transactions** | Java EE's standard for distributed transactions across databases and message brokers (JMS). Behind the scenes, it uses XA-compliant resource managers. |
| **Microsoft DTC** | Distributed Transaction Coordinator — coordinates 2PC across SQL Server, MSMQ, and other COM+ resources. |

In most Node.js applications, you will not implement 2PC directly — you will instead use the patterns in the comparison below.

## 2PC vs Saga — When Each Fits

| Aspect | 2PC | Saga |
|--------|-----|------|
| **Coordination** | Central coordinator drives prepare → commit/abort | Choreography (events) or orchestrator drives local transactions |
| **Consistency** | Strong (ACID) — all or nothing | Eventual — each step commits locally, compensating actions unwind on failure |
| **Locking** | Holds locks from prepare until commit — seconds max | No distributed locks — each local transaction commits immediately |
| **Latency** | All participants must respond before any commits | Steps execute sequentially; each commits before the next starts |
| **Failure handling** | Protocol handles it — rollback all participants | Developer writes compensating actions for each step |
| **Data visibility** | Uncommitted data is invisible (isolation) | Each step's data is visible as soon as it commits |
| **Scale** | 3-5 participants max; coordination overhead grows with N | Works with dozens of participants; no central bottleneck |
| **Typical duration** | Milliseconds to seconds | Seconds to hours |

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

- [ACID Compliance](acid-compliance.md) — the four properties that distributed transactions preserve across participants
- [Distributed Systems](distributed-systems.md) — distributed transactions are a coordination strategy for multi-service systems
- [Database Concurrency Control](database-concurrency-control.md) — ACID, locking, and isolation levels at the single-node level
- [Outbox Pattern](outbox-pattern.md) — alternative for event delivery that avoids distributed transactions
- [Saga Pattern](saga-pattern.md) — compensation-based alternative for long-running business workflows
- [CAP Theorem](cap-theorem.md) — distributed transactions trade availability for consistency
- Two-Phase Commit (2PC)
- Three-Phase Commit (3PC)
- XA Standard
- TCC (Try-Confirm/Cancel)

---

## Key Takeaways

> Distributed transactions (2PC/XA) provide strong consistency across services at the cost of latency, availability, and operational complexity. They are rarely the right choice in modern microservices — Sagas, Outbox, and idempotency offer better availability and scalability with eventual consistency. Use distributed transactions only when strong cross-service consistency is non-negotiable and the coordination overhead is acceptable.
