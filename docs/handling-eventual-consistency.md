# Handling Eventual Consistency

> A practical guide to designing systems that tolerate temporary data staleness — covering read-your-writes, conflict resolution, compensating actions, and UI patterns.

---

## What is it?

Eventual consistency means that given enough time without new updates, all replicas of a distributed system will converge to the same value. In the meantime, different clients may see different states. Handling eventual consistency is the discipline of designing application logic, APIs, and user interfaces that remain correct under temporary staleness — deciding when to accept it, when to block for strong consistency, and how to reconcile divergent states when they occur.

---

## Without handling it

- A user updates their profile, refreshes, and sees the old value (stale read).
- An admin disables a product, but a customer buys it moments later because the disable had not propagated.
- A payment is retried and the customer is charged twice because the deduplication check ran against a stale replica.
- Two users increment a counter concurrently, both seeing `count = 5` and both writing `6` — one increment is lost.

The goal is not to eliminate staleness — that is impossible without strong consistency, which sacrifices availability and latency. The goal is to ensure staleness does not cause incorrect behaviour.

---

## Example

### Simple Case: Stale Read After Write

A user updates their display name, refreshes the page, and sees the old name because the read went to a replica that has not caught up.

```text
Client               Primary              Replica
  │                    │                    │
  │  PATCH /profile    │                    │
  │  name="Alice"     │                    │
  │ ────────────────► │                    │
  │                    │  UPDATE name='Alice'
  │                    │ ────┐              │
  │                    │    │ write         │
  │                    │ ◄───┘              │
  │                    │                    │
  │  GET /profile      │   replication lag  │
  │ ───────────────────────────────────────►│
  │                    │                    │
  │  name="Bob" (stale)│                    │
  │ ◄───────────────────────────────────────│
  │                    │                    │
  │  (eventually)      │  propagate ──────► │
  │                    │                    │
  │  GET /profile      │                    │
  │ ───────────────────────────────────────►│
  │                    │                    │
  │  name="Alice"      │                    │
  │ ◄───────────────────────────────────────│
```

### Solution: Read-Your-Writes Consistency

Route the user's own-data reads to the primary for a short window after their write:

```typescript
import { createPool } from 'mysql2/promise';

const primary = createPool({ /* primary connection */ });
const replica = createPool({ /* replica connection */ });

async function getUserProfile(userId: string, lastWriteAt?: number) {
  const STICKY_WINDOW_MS = 5_000; // 5 seconds

  // If the user wrote within the sticky window, read from primary
  const usePrimary = lastWriteAt
    && (Date.now() - lastWriteAt) < STICKY_WINDOW_MS;

  const db = usePrimary ? primary : replica;
  const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
  return rows[0];
}

// On write, return the timestamp to the client
app.patch('/profile', async (req, res) => {
  const { name } = req.body;
  await primary.execute('UPDATE users SET name = ? WHERE id = ?', [name, req.userId]);
  res.json({ lastWriteAt: Date.now(), name });
});
```

---

## Architecture / Flow

### Decision Tree: Strong vs Eventual

```text
Is the reader the writer?
    │
    ├── YES ──► Read-your-writes consistency (route to primary)
    │
    └── NO
         │
         Is the data critical for correctness? (inventory, balance)
         │
         ├── YES ──► Strong consistency (SELECT FOR UPDATE, quorum read)
         │
         └── NO
              │
              Is staleness detectable by the user? (feed, profile, search)
              │
              ├── YES ──► Eventual consistency + UI hint (pull-to-refresh, stale badge)
              │
              └── NO ──► Eventual consistency (accept staleness silently)
```

### Strategy Map

| Strategy | What it Solves | When to Apply |
|----------|---------------|---------------|
| **Read-your-writes** | User sees stale data after their own write | User-facing writes (profile, settings, create) |
| **Idempotency** | Duplicate writes from retries | Payment, order creation, any side effect |
| **Compensating actions (Saga)** | Partial failure across services | Multi-step workflows |
| **Version vectors / optimistic locking** | Concurrent writes to the same record | Collaborative editing, inventory |
| **Outbox + at-least-once** | Lost events that never propagate | Event-driven communication between services |
| **Polling / WebSockets** | Out-of-date UI that does not refresh | Dashboards, notification counters |
| **CRDTs** | Offline edits that must merge without conflict | Offline-first apps, collaborative docs |

---

## Strategies

### 1. Read-Your-Writes (Session Consistency)

After a client writes, their subsequent reads reflect that write — even if reads normally go to replicas.

Implementation options:
- Route reads from the same client to the primary for a time window (sticky session based on time, not IP).
- Track `lastWriteAt` per user in the application and check it on read.
- Use cookies or response headers to signal staleness window to the client.

```typescript
const STICKY_WRITE_MS = 10_000;

function getDbForUser(userId: string): Pool {
  const lastWrite = writeTimestamps.get(userId);
  if (lastWrite && Date.now() - lastWrite < STICKY_WRITE_MS) {
    return primary; // still in sticky window
  }
  return replica;
}
```

### 2. Idempotency for Safe Retries (See [Idempotency](idempotency.md))

At-least-once delivery guarantees that a message is delivered, but it may be delivered multiple times. Idempotency ensures duplicates have no effect:

```typescript
async function chargeCustomer(idempotencyKey: string, amount: number) {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.idempotencyKey.findUnique({
      where: { key: idempotencyKey }
    });
    if (existing) return existing.result; // duplicate — return cached result
    const charge = await stripe.charges.create({ amount });
    await tx.idempotencyKey.create({
      data: { key: idempotencyKey, result: charge.id }
    });
    return charge.id;
  });
}
```

### 3. Compensating Actions (See [Saga Pattern](saga-pattern.md))

When a multi-step workflow partially fails, compensating actions undo what was already done:

```text
Order created (pending)
    │
    ├── Inventory reserved ✓
    ├── Payment charged ✓
    └── Shipment failed ✗
         │
         └── Compensate: refund payment, release inventory
```

### 4. Optimistic Locking with Version Vectors (See [Database Concurrency Control](database-concurrency-control.md))

Detect concurrent writes at commit time rather than preventing them upfront:

```typescript
async function updateCartItem(userId: string, productId: string, quantity: number, expectedVersion: number) {
  const result = await prisma.cartItem.updateMany({
    where: { userId, productId, version: expectedVersion },
    data: { quantity, version: { increment: 1 } }
  });
  if (result.count === 0) {
    throw new ConflictError('Cart item was modified by another request');
  }
}
```

### 5. Reliable Event Delivery (See [Outbox Pattern](outbox-pattern.md))

Events that are never published are permanently lost — the most severe form of inconsistency. The outbox pattern guarantees publication:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.order.create({ data: order });
  await tx.outbox.create({ data: { type: 'OrderCreated', payload: order } });
});
// The poller guarantees the event reaches the message broker
```

### 6. UI Patterns for Staleness

Even if the backend handles consistency well, the UI must set user expectations:

- **Optimistic updates** — show the expected result immediately, reconcile if it fails
- **Staleness indicators** — "Last updated 2 minutes ago" label
- **Pull-to-refresh** — let the user trigger a fresh read
- **Polling / WebSockets** — push updates when data changes
- **Conflict notifications** — "Someone else changed this while you were editing"

```typescript
// Optimistic update in a React component
function ProfilePage() {
  const [name, setName] = useState('');

  async function handleSave(newName: string) {
    // Show the new name immediately
    setName(newName);
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: newName })
      });
    } catch {
      // Revert on failure
      setName(currentName);
      showError('Failed to save. Please try again.');
    }
  }
}
```

### 7. Conflict-Free Replicated Data Types (CRDTs)

For offline-first or multi-leader systems, CRDTs allow concurrent edits to merge without conflicts:

| CRDT Type | Data | Merge Strategy |
|-----------|------|----------------|
| **GCounter** | Increment-only counter | Take the max of each peer's value |
| **PNCounter** | Increment/decrement counter | Counter = sum of increments − sum of decrements |
| **LWW-Register** | Last-writer-wins value | Timestamp comparison |
| **OR-Set** | Add/remove set | Remove only if the element was added and then removed |

```typescript
// Simplified last-writer-wins register
class LWWRegister<T> {
  constructor(
    private value: T,
    private timestamp: number
  ) {}

  merge(other: LWWRegister<T>): LWWRegister<T> {
    // Trusts the later timestamp
    return other.timestamp > this.timestamp ? other : this;
  }
}
```

---

## How it Works

1. A client writes data to one node (primary, leader, or local replica).
2. The write is propagated to other replicas asynchronously (eventual consistency) or synchronously (strong consistency).
3. Another client (or the same client) reads from a replica that has not yet received the update.
4. The application detects whether staleness is acceptable for this read:
   - If the read is the writer's own data → route to the primary or use read-your-writes consistency.
   - If the data is critical (balance, inventory) → use strong consistency (quorum, `SELECT FOR UPDATE`).
   - Otherwise → accept staleness and handle conflicts at write time.
5. When concurrent writes conflict, they are resolved by the chosen strategy:
   - Last-writer-wins (LWW) — simple but may lose data.
   - Version vectors / optimistic locking — one writer succeeds, the client retries the other.
   - CRDTs — both writes merge without conflict.
6. When operations span multiple services, compensating actions undo partial work (Saga).
7. The UI communicates state to the user: optimistic updates, staleness badges, pull-to-refresh.

---

## Advantages

- **Availability** — the system accepts writes even when some replicas are unreachable
- **Low latency** — writes complete on one node instead of waiting for quorum
- **Horizontal scale** — read replicas can serve stale data without coordinating with the primary
- **Offline support** — local writes sync later when connectivity resumes
- **Simpler coordination** — no distributed lock or consensus required for most operations

---

## Trade-offs

- **Stale reads** — clients may read old data; the application must handle this correctly
- **Write conflicts** — concurrent writes can conflict; must choose a resolution strategy
- **Operational complexity** — read-your-writes routing, conflict detection, compensating actions all add code
- **User experience challenges** — staleness can confuse users if not surfaced properly
- **Not suitable for all data** — inventory, balances, and critical state still need strong consistency

---

## When to Use

- **Social feeds, timelines, recommendations** — staleness of seconds to minutes is invisible
- **User profiles, settings, preferences** — use read-your-writes so the user sees their own changes immediately
- **Search indexes** — eventual consistency between write and index is the norm
- **Analytics, dashboards, reports** — near-real-time is acceptable; strong consistency adds cost
- **Offline-first applications** — local writes must merge later (use CRDTs or version vectors)
- **Notifications, email delivery** — at-least-once delivery + idempotency

---

## When NOT to Use

- **Financial ledgers, balances** — every read must reflect the latest state; use strong consistency
- **Inventory reservation during flash sales** — overselling due to stale reads is unacceptable
- **Distributed locks, leader election** — requires linearizable consistency (see [Consensus Algorithms](consensus-algorithms.md))
- **Authentication tokens, permission checks** — stale permission data can cause security issues
- **Any data where inconsistency causes legal or financial liability**

---

## Related Concepts

- [Consistency Models](consistency-models.md) — the theoretical spectrum from strong to eventual
- [Idempotency](idempotency.md) — safe retries under at-least-once delivery
- [Outbox Pattern](outbox-pattern.md) — guarantees events are published so replicas eventually receive them
- [Saga Pattern](saga-pattern.md) — compensating actions for eventual consistency across services
- [Delivery Semantics](delivery-semantics.md) — at-least-once vs exactly-once in messaging
- [Database Concurrency Control](database-concurrency-control.md) — optimistic locking, version vectors
- [CQRS](cqrs.md) — stale read models that are rebuilt from the event stream
- [Event Sourcing](event-sourcing.md) — event store as the source of truth; projections converge eventually
- [CAP Theorem](cap-theorem.md) — the fundamental trade-off that forces eventual consistency during partitions
- CRDTs
- Vector Clocks

---

## Key Takeaways

> Eventual consistency is not a flaw — it is a deliberate trade-off that enables availability, low latency, and horizontal scale. The key is not to eliminate staleness but to design around it: apply read-your-writes so users see their own changes, use idempotency to make retries safe, use optimistic locking to detect concurrent writes, use compensating actions to unwind partial failures, and surface staleness in the UI so users understand what they are seeing. Strong consistency (quorum, `SELECT FOR UPDATE`, consensus) should be reserved for the small fraction of data where staleness is unacceptable. For everything else, embrace eventual consistency and design defensively.
