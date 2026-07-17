# Event Sourcing

> Storing state as an append-only sequence of events rather than as the current state, enabling full auditability, temporal queries, and event-driven projections.

---

## What is it?

**Event Sourcing** persists every state change as an immutable event in an append-only store. The current state is derived by replaying the event stream from the beginning. This is the opposite of a CRUD-style system where only the latest state is stored.

| Concept | CRUD | Event Sourcing |
|---------|------|----------------|
| Write | `UPDATE orders SET status = 'confirmed' WHERE id = 1` | `INSERT INTO events (type, data) VALUES ('OrderConfirmed', {...})` |
| Read | `SELECT * FROM orders WHERE id = 1` | Replay events for order 1 to compute current state |
| History | Lost (only latest state) | Complete (every change preserved) |
| Deletion | `DELETE` removes data | Events are immutable; a deletion event is appended |

A **projection** (also called a read model) subscribes to the event stream and builds denormalised views optimised for queries — this is where Event Sourcing pairs naturally with [CQRS](cqrs.md).

---

## Problem

A standard database stores only the current state. This creates several limitations:

- **No audit trail** — who changed what and when? The current row does not tell you. You need a separate audit log that must be kept in sync manually.
- **No temporal queries** — "what did the order look like yesterday?" or "what was the inventory level at the time of this payment?" are impossible or require complex historical snapshots.
- **Event loss** — when state changes, the previous state is overwritten. Downstream services that missed an event have no way to catch up.
- **Bounded domain logic** — the current state does not capture the business context that led to it (why was the order cancelled? What was the previous status?).

---

## Example

### Event Store (Append-Only Log)

```sql
CREATE TABLE events (
  id              BIGSERIAL PRIMARY KEY,
  aggregate_id    UUID NOT NULL,
  aggregate_type  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  event_data      JSONB NOT NULL,
  version         INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (aggregate_id, version)
);

CREATE INDEX idx_events_aggregate ON events (aggregate_id, version);
```

### Writing Events

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function applyOrderEvents(orderId: string) {
  const event = {
    aggregateId: orderId,
    aggregateType: 'order',
    eventType: 'OrderPlaced',
    eventData: { customerId: 'c123', total: 99.99 },
  };

  // Append with optimistic concurrency — version check prevents conflicts
  const lastEvent = await prisma.event.findFirst({
    where: { aggregateId: orderId },
    orderBy: { version: 'desc' }
  });

  await prisma.event.create({
    data: {
      ...event,
      version: (lastEvent?.version ?? 0) + 1
    }
  });
}
```

### Rebuilding State from Events

```typescript
type OrderState = {
  id: string;
  customerId: string;
  status: string;
  total: number;
};

async function rebuildOrderState(orderId: string): Promise<OrderState> {
  const events = await prisma.event.findMany({
    where: { aggregateId: orderId },
    orderBy: { version: 'asc' }
  });

  let state: Partial<OrderState> = { id: orderId };

  for (const event of events) {
    switch (event.eventType) {
      case 'OrderPlaced':
        state = { ...state, customerId: event.eventData.customerId, total: event.eventData.total, status: 'pending' };
        break;
      case 'PaymentConfirmed':
        state = { ...state, status: 'confirmed' };
        break;
      case 'OrderShipped':
        state = { ...state, status: 'shipped', shippedAt: event.createdAt };
        break;
      case 'OrderCancelled':
        state = { ...state, status: 'cancelled', reason: event.eventData.reason };
        break;
    }
  }

  return state as OrderState;
}
```

### Projection (Read Model)

A projection builds a denormalised read model from the event stream — this is the [CQRS](cqrs.md) query side:

```typescript
async function buildOrderSummaryProjection() {
  const events = await prisma.event.findMany({
    where: { aggregateType: 'order' },
    orderBy: { version: 'asc' }
  });

  for (const event of events) {
    switch (event.eventType) {
      case 'OrderPlaced':
        await prisma.orderSummary.upsert({
          where: { orderId: event.aggregateId },
          update: {
            customerId: event.eventData.customerId,
            total: event.eventData.total,
            status: 'pending',
          },
          create: {
            orderId: event.aggregateId,
            customerId: event.eventData.customerId,
            total: event.eventData.total,
            status: 'pending',
          }
        });
        break;
      case 'PaymentConfirmed':
        await prisma.orderSummary.update({
          where: { orderId: event.aggregateId },
          data: { status: 'confirmed' }
        });
        break;
    }
  }
}
```

### Snapshotting

Replaying thousands of events on every read is slow. Snapshots store the state at a given version so replay starts from the snapshot, not the beginning:

```typescript
async function rebuildWithSnapshot(orderId: string): Promise<OrderState> {
  // Load the latest snapshot
  const snapshot = await prisma.snapshot.findFirst({
    where: { aggregateId: orderId },
    orderBy: { version: 'desc' }
  });

  let state = snapshot?.state ?? { id: orderId };
  const fromVersion = snapshot?.version ?? 0;

  // Replay only events after the snapshot
  const events = await prisma.event.findMany({
    where: { aggregateId: orderId, version: { gt: fromVersion } },
    orderBy: { version: 'asc' }
  });

  return applyEvents(state, events);
}
```

---

## Architecture / Flow

```text
Write Path (Commands):
┌──────────┐    ┌──────────────┐    ┌─────────────────┐
│ Command  │───►│  Validate     │───►│  Append event   │
│ Handler  │    │  Business     │    │  to event store │
│          │    │  Logic        │    │  (immutable)    │
└──────────┘    └──────────────┘    └────────┬────────┘
                                             │
                                             ▼
                                      Event Store
                                      (Append-only)
                                      ┌──────────┐
                                      │ Event 1  │
                                      │ Event 2  │
                                      │ Event 3  │
                                      │ ...      │
                                      └──────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
             Read Model 1          Read Model 2          Read Model 3
            (Projection)          (Projection)          (Projection)
        ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
        │ Order        │     │ Customer     │     │ Analytics    │
        │ Summary      │     │ Dashboard    │     │ Warehouse    │
        └──────────────┘     └──────────────┘     └──────────────┘
```

---

## How it Works

1. A command handler receives a request (e.g. `PlaceOrder`).
2. It loads the current state by replaying all events for that aggregate (or from the latest snapshot).
3. It validates the command against the current state (e.g. "order is not already placed").
4. It creates a new event and appends it to the event store with optimistic concurrency (`version + 1`).
5. The event is published to an internal event bus or message queue (optionally via the [Outbox Pattern](outbox-pattern.md)).
6. Projections consume the event and update their read models (see [CQRS](cqrs.md)).
7. To read the current state, the application replays all events for the aggregate (or starts from the latest snapshot).
8. Snapshots are taken periodically (every N events or on a schedule) to keep replay fast.

---

## Advantages

| Advantage | Impact |
|-----------|--------|
| **Complete audit trail** — every state change is recorded with the full context | No separate audit log needed; events are the audit log |
| **Temporal queries** — reconstruct state at any point in time | Debugging, compliance, and "what happened?" investigations |
| **Event-driven by default** — events are the source of truth, not a byproduct | The event store naturally feeds projections, [Saga](saga-pattern.md) steps, and analytics |
| **Debugging and replay** — fix a bug, replay events from the past with corrected logic | Rebuild any read model from scratch at any time |
| **Loose coupling** — the event store does not know about consumers | New projections can be added without modifying the write path |

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Event store growth** — the event log grows indefinitely | Requires archiving, snapshotting, or retention policies |
| **Read complexity** — reading state means replaying events or maintaining separate read models | Always pair with [CQRS](cqrs.md) for acceptable query performance |
| **Event schema evolution** — old events may have different shapes than new events | Upcasting (migrating old events to new schema) must be handled at read time |
| **Consistency model** — projections are eventually consistent | There is a lag between event append and read model update |
| **Learning curve** — the mental model differs significantly from CRUD | Team training and discipline around event design are required |

---

## When to Use

- Systems that need a complete audit trail (finance, compliance, healthcare)
- Domains where knowing "what happened" is as important as "what is" (ledger, booking history, order lifecycle)
- Systems already using [CQRS](cqrs.md) — event sourcing is the natural write side
- Event-driven architectures where events are the primary integration mechanism

---

## When NOT to Use

- Simple CRUD applications with no audit or temporal query requirements
- Systems where query performance on current state is the priority and eventual consistency is unacceptable
- Domains that frequently delete data or have strong privacy requirements (right to erasure) — event sourcing makes deletion semantically difficult
- Small teams where the operational overhead of event store, projections, and snapshots outweighs the benefits

---

## Related Concepts

- [CQRS](cqrs.md) — event sourcing is the natural write side of CQRS; projections build the read models
- [Outbox Pattern](outbox-pattern.md) — the event store serves as the reliable event source for the outbox publisher
- [Saga Pattern](saga-pattern.md) — saga steps can emit events that become part of the event stream
- [Event-Driven Architecture](event-driven-architecture.md) — event sourcing is an implementation strategy within an event-driven system
- [Distributed Systems](distributed-systems.md) — multi-service event sourcing requires event ordering and consistency guarantees
- Snapshotting
- Upcasting / Schema Evolution
- Projection / Materialised View

---

## Key Takeaways

> Event Sourcing stores every state change as an immutable event in an append-only log. The current state is rebuilt by replaying events — or loaded from a snapshot for performance. It provides a complete audit trail, temporal queries, and natural event-driven integration. Always pair with [CQRS](cqrs.md) for acceptable read performance. The trade-offs are event store growth, eventual consistency of projections, and event schema evolution complexity.
