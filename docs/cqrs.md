# CQRS (Command Query Responsibility Segregation)

> Separating read and write operations into different models — commands change state, queries return state — so each side can be optimised independently.

---

## What is it?

**CQRS** splits a service's data operations into two distinct paths:

- **Commands** — write operations that change state (insert, update, delete). They return no data, only success or failure.
- **Queries** — read operations that return data. They have no side effects.

In its full form, commands and queries use different database schemas or entirely different data stores — the read side is a denormalised projection optimised for queries, while the write side is normalised for transactional integrity.

---

## Problem

A single model (e.g. one Prisma schema, one set of tables) used for both reads and writes forces compromises:

- A single normalised schema suits transactional writes but requires multiple joins (slow) for complex read queries.
- Adding read-optimised indexes slows down writes.
- A read-heavy feature (dashboard, analytics, search) adds complexity and risk to the write code path.
- The write model's schema leaks into the read API — clients get data shaped for storage, not for their UI.
- Scaling reads and writes together is difficult — one may need replicas while the other needs stronger consistency.

---

## Example

### Separating Command and Query Models (Same Database)

The write model is normalised for transactional integrity:

```typescript
// ─── Command Side (Write Model) ───
// Normalised tables, transactional updates
async function placeOrder(customerId: string, items: OrderItem[]) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { customerId, status: 'pending' }
    });

    for (const item of items) {
      await tx.orderLineItem.create({
        data: { orderId: order.id, productId: item.productId, quantity: item.quantity }
      });

      await tx.inventory.update({
        where: { productId: item.productId },
        data: { stock: { decrement: item.quantity } }
      });
    }
  });
}
```

The read model is denormalised for fast queries:

```typescript
// ─── Query Side (Read Model) ───
// Denormalised — one table, no joins, optimised for the dashboard view
async function getOrderDashboard(customerId: string) {
  return prisma.orderSummary.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    select: {
      orderId: true,
      customerName: true,
      totalItems: true,
      totalAmount: true,
      status: true,
      createdAt: true,
    }
  });
}
```

The read model is kept in sync by subscribing to events from the write side:

```typescript
// Event handler projects write events into the read model
async function onOrderCreated(event: OrderCreatedEvent) {
  const tally = await computeOrderSummary(event.orderId);

  await prisma.orderSummary.upsert({
    where: { orderId: event.orderId },
    update: {
      totalItems: tally.itemCount,
      totalAmount: tally.amount,
      status: 'pending',
    },
    create: {
      orderId: event.orderId,
      customerId: event.customerId,
      customerName: event.customerName,
      totalItems: tally.itemCount,
      totalAmount: tally.amount,
      status: 'pending',
    }
  });
}
```

### Separate Databases for Read and Write

In a full CQRS implementation, the read and write sides use independent databases:

```typescript
import { PrismaClient as WriteDb } from '@prisma/client';
import { PrismaClient as ReadDb } from '@prisma/client';

const writeDb = new WriteDb({ datasources: { db: { url: process.env.WRITE_DATABASE_URL } }});
const readDb = new ReadDb({ datasources: { db: { url: process.env.READ_DATABASE_URL } }});

// Command — writes to the transactional database
async function createOrder(customerId: string) {
  return writeDb.order.create({ data: { customerId, status: 'pending' } });
}

// Query — reads from the read-optimised database
async function getOrders(customerId: string) {
  return readDb.orderSummary.findMany({ where: { customerId } });
}
```

---

## Architecture / Flow

```text
Client (Write)                  Client (Read)
      │                              │
      │  POST /orders                 │  GET /orders/dashboard
      ▼                              ▼
┌──────────────┐             ┌──────────────┐
│  Command      │             │   Query       │
│  Handler     │             │   Handler    │
│  (Write API) │             │   (Read API) │
└──────┬───────┘             └──────┬───────┘
       │                            │
       ▼                            ▼
┌──────────────┐             ┌──────────────┐
│  Write DB    │             │   Read DB    │
│  (Normalised)│             │ (Denormalised)│
│  PostgreSQL  │             │  PostgreSQL   │
└──────┬───────┘             └──────┬───────┘
       │                            ▲
       │   Sync via events          │
       └────────────────────────────┘
         (Outbox / CDC / Projection)
```

---

## How it Works

1. A **command** arrives at the write API — e.g. `POST /orders` with order data.
2. The command handler validates the input, executes business logic, and writes to the **write database** (normalised, transactional).
3. The write side publishes an event (`OrderCreated`) via the [Outbox Pattern](outbox-pattern.md) or CDC.
4. A **projection** (event handler) consumes the event and updates the **read database** — denormalising the data into the shape the query API needs.
5. A **query** arrives at the read API — e.g. `GET /orders/dashboard` — and reads from the read database with no joins, no business logic, and no locks.
6. The read and write databases are **eventually consistent** — there is a small lag between command acceptance and query visibility.

---

## Advantages

| Advantage | Impact |
|-----------|--------|
| **Read/write independence** — each side can be scaled, optimised, and deployed separately | Read replicas can handle dashboard traffic without affecting order writes |
| **Query simplicity** — read models are shaped for specific use cases, eliminating complex joins | A dashboard query becomes `SELECT * FROM order_summary WHERE customer_id = ?` |
| **Write simplification** — command handlers focus on business rules, not read optimisations | Fewer indexes on write tables, faster inserts and updates |
| **Schema flexibility** — the read model can be restructured without changing the write schema | Adding a new dashboard view does not require migrations on the transactional database |
| **Security** — the read API can expose only the data the client needs, never raw tables | Prevents accidental data leaks through over-fetching |

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Eventual consistency** — reads may lag behind writes by milliseconds to seconds | Users may refresh and see stale data; not suitable for strict read-your-writes scenarios |
| **Operational complexity** — two databases, projection handlers, sync monitoring | More infrastructure, more failure modes, more deployment coordination |
| **Duplicate logic** — validation rules on the write side may need to be represented in the read projections | Can lead to inconsistencies if projections miss edge cases |
| **Projection lag** — if the event stream slows, the read side falls behind | Requires monitoring of projection freshness; large backlogs can take time to catch up |
| **Overkill for CRUD** — simple create-read-update-delete operations do not benefit from separate models | Adds unnecessary complexity to straightforward data access patterns |

---

## When to Use

- Read-heavy applications where the read workload differs significantly from the write workload (dashboards, reporting, analytics)
- Systems where the same data is consumed by multiple clients that need different shapes (mobile app, web dashboard, third-party API)
- High-write-volume systems where adding read indexes would slow down writes
- Teams that want to optimise query performance without risking write path stability
- Often paired with [Event Sourcing](event-sourcing.md), where the event store is the write side and projections build the read models

---

## When NOT to Use

- Simple CRUD applications with straightforward data access — a single model is simpler and faster to build
- Systems that require strong read-your-writes consistency on the same data model
- Small teams where the operational overhead of managing two databases outweighs the performance gain
- Prototypes or early-stage products where speed of iteration matters more than read optimisation

---

## Related Concepts

- [Event Sourcing](event-sourcing.md) — commonly paired with CQRS; the event store serves as the write model and projections build read models
- [Outbox Pattern](outbox-pattern.md) — reliably publishes events from the write side to drive read model projections
- [Distributed Systems](distributed-systems.md) — CQRS is a common pattern in multi-service architectures for decoupling read and write concerns
- [Database Concurrency Control](database-concurrency-control.md) — write side uses transactions and locking; read side reads without locks
- [Saga Pattern](saga-pattern.md) — saga steps can update both write and read models as part of a workflow
- [Delivery Semantics](delivery-semantics.md) — read model projections typically use at-least-once delivery
- Projection / Materialised View
- Eventual Consistency

---

## Key Takeaways

> CQRS separates the write model (commands, normalised, transactional) from the read model (queries, denormalised, optimised). This allows each side to be scaled and optimised independently at the cost of eventual consistency between them. Use CQRS when read workloads differ significantly from write workloads — dashboards, analytics, and multi-client APIs. It pairs naturally with Event Sourcing and the Outbox Pattern for reliable event-driven projections.
