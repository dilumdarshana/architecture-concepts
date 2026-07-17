# Saga Pattern

> A sequence of local transactions where each step publishes an event or message that triggers the next step, with compensating actions that undo prior steps on failure.

---

## What is it?

A **Saga** is an alternative to [Distributed Transactions](distributed-transactions.md) for maintaining data consistency across multiple services without a coordinating lock or two-phase commit. Each step in a saga is a local transaction that commits independently. If a step fails, the saga executes **compensating transactions** to undo the effects of previous steps.

There are two styles:

| Style | Coordination | Communication | Example |
|-------|-------------|---------------|---------|
| **Choreography** | Decentralized — each service publishes events that trigger the next step | Event-driven (message queue) | OrderCreated -> InventoryReserved -> PaymentConfirmed |
| **Orchestration** | Centralized — an orchestrator tells each service what to do and when | Command-driven (queue or HTTP) | Orchestrator sends "ReserveInventory", waits for reply, then sends "ChargePayment" |

---

## Problem

A distributed transaction that spans Order, Inventory, and Payment services cannot use a single ACID transaction — each service owns its own database. Without a saga:

- An order is created but inventory is never reserved (partial write).
- A payment is charged but the order creation failed (orphan charge).
- Manual reconciliation is needed to detect and fix inconsistencies.

The [distributed transaction](distributed-transactions.md) (2PC) alternative provides strong consistency but sacrifices availability, adds latency, and requires all participants to support the same protocol.

---

## Example

### Choreography Saga (Event-Driven)

Each service publishes events that trigger the next step. The Order Service publishes `OrderCreated`, Inventory Service consumes it and publishes `InventoryReserved`, and so on.

```typescript
// Order Service: first step
import { PrismaClient } from '@prisma/client';
import { SQS } from 'aws-sdk';

const prisma = new PrismaClient();
const sqs = new SQS();

async function createOrder(customerId: string, items: Item[]) {
  // Local transaction 1
  const order = await prisma.order.create({
    data: { customerId, status: 'pending' }
  });

  // Publish event to trigger next step
  await sqs.sendMessage({
    QueueUrl: process.env.ORDER_CREATED_QUEUE!,
    MessageBody: JSON.stringify({ orderId: order.id, items })
  }).promise();
}

// Inventory Service: consumes OrderCreated
async function handleOrderCreated(event: OrderCreatedEvent) {
  // Local transaction 2 — reserve inventory
  await prisma.inventoryReservation.create({
    data: { orderId: event.orderId, items: event.items }
  });

  await sqs.sendMessage({
    QueueUrl: process.env.INVENTORY_RESERVED_QUEUE!,
    MessageBody: JSON.stringify({ orderId: event.orderId })
  }).promise();

  // On failure, publish InventoryReservationFailed ->
  // Order Service compensates by marking order as failed
}
```

### Orchestration Saga (Command-Driven)

An orchestrator service manages the workflow explicitly:

```typescript
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sagaQueue = new Queue('saga-checkout');

async function checkoutSaga(orderId: string) {
  const sagaId = crypto.randomUUID();

  try {
    await createOrder(sagaId, orderId);
    await reserveInventory(sagaId, orderId);
    await chargePayment(sagaId, orderId);
    await confirmOrder(sagaId, orderId);
  } catch (error) {
    await compensate(sagaId, orderId);
  }
}

async function compensate(sagaId: string, orderId: string) {
  // Checkpoint: lookup which steps completed and compensate in reverse order
  const steps = await prisma.sagaStep.findMany({
    where: { sagaId },
    orderBy: { stepNumber: 'desc' }
  });

  for (const step of steps) {
    switch (step.name) {
      case 'chargePayment':
        await refundPayment(orderId);
        break;
      case 'reserveInventory':
        await releaseInventory(orderId);
        break;
      case 'createOrder':
        await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' }});
        break;
    }
  }
}
```

---

## Architecture / Flow

### Choreography

```text
Order Service          Inventory Service       Payment Service
    │                       │                       │
    │  ┌────────────────┐   │                       │
    │  │ Create order   │   │                       │
    │  │ (pending)      │   │                       │
    │  └───────┬────────┘   │                       │
    │          │            │                       │
    │  OrderCreated         │                       │
    │─────────────────────►│                       │
    │                      │  ┌────────────────┐   │
    │                      │  │ Reserve stock  │   │
    │                      │  └───────┬────────┘   │
    │                      │          │            │
    │                      │  InventoryReserved    │
    │                      │──────────────────────►│
    │                      │                       │  ┌────────────────┐
    │                      │                       │  │ Charge card    │
    │                      │                       │  └───────┬────────┘
    │                      │                       │          │
    │◄─────────────────────────────────────────────│  PaymentConfirmed
    │                      │                       │
    │  ┌────────────────┐  │                       │
    │  │ Confirm order  │  │                       │
    │  └────────────────┘  │                       │
```

### Orchestration

```text
                Orchestrator
                     │
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
  Order Svc    Inventory Svc    Payment Svc

   1. createOrder ──► succeeds
   2. reserveInventory ──► succeeds
   3. chargePayment ──► fails!
   4. COMPENSATE: refund ──► succeeds
   5. COMPENSATE: releaseInventory ──► succeeds
   6. COMPENSATE: cancelOrder ──► succeeds
```

---

## How it Works

1. The saga begins with a local transaction on the initiating service (e.g. create order with `status: pending`).
2. On success, the service publishes an event (choreography) or sends a command (orchestration) for the next step.
3. The next service receives the event, performs its local transaction, and publishes its own event.
4. Steps continue sequentially — each service committing independently.
5. If a step fails, the saga enters compensation mode:
   - **Choreography**: a failure event is published; each service listens and compensates.
   - **Orchestration**: the orchestrator calls compensating actions in reverse order.
6. Each compensating action is itself a local transaction (e.g. refund payment, release inventory, cancel order).
7. The saga completes when all steps succeed or all steps are compensated.
8. Idempotency and the [Outbox Pattern](outbox-pattern.md) ensure reliable event delivery and safe retries at each step.

---

## Advantages

- **No long-lived locks** — each step commits immediately; no distributed lock held across services
- **High availability** — no single coordinator point of failure (in choreography)
- **Scalability** — services remain independent; no blocking coordination protocol
- **Familiar patterns** — uses events, queues, and local transactions — the same tools as the rest of the system
- **Partial success** — the system knows exactly which steps completed and can resume or compensate

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Eventual consistency** — there is a window between steps where the system is partially committed | Downstream services see intermediate states (pending orders, temporary reservations) |
| **Compensation complexity** — compensating actions must be idempotent and correctly reverse each step | Not all operations are easily reversible (e.g. "send email" has no meaningful compensation) |
| **Orchestrator SPOF** — in orchestration style, the orchestrator is a single point of failure | Requires its own persistence and recovery mechanism |
| **Choreography coupling** — services implicitly know about each other's events | Evolving event schemas can break downstream consumers |
| **Debugging difficulty** — a saga spans multiple services and databases | Requires distributed tracing to follow the full flow |

---

## When to Use

- Business workflows that span multiple services — checkout, account opening, booking flows
- Systems that need high availability and cannot tolerate 2PC's blocking protocol
- Long-running business processes where holding locks is impractical
- Event-driven architectures already using message queues

---

## When NOT to Use

- Operations that require strong cross-service consistency (use [Distributed Transactions](distributed-transactions.md) if the cost is acceptable)
- Simple single-service workflows that do not need coordination
- Operations where compensating actions are impossible or semantically meaningless
- Systems that cannot tolerate eventual consistency windows

---

## Related Concepts

- [Distributed Transactions](distributed-transactions.md) — the strong-consistency alternative; saga avoids 2PC overhead
- [Outbox Pattern](outbox-pattern.md) — each saga step uses the outbox pattern for reliable event publication
- [Distributed Systems](distributed-systems.md) — saga coordinates independent services in a distributed architecture
- [Idempotency](idempotency.md) — compensating actions and step retries must be idempotent
- [Promise APIs](promise-apis.md) — orchestration can use `Promise.allSettled` to collect step outcomes
- Choreography vs Orchestration
- Compensating Transaction
- [Event-Driven Architecture](event-driven-architecture.md)

---

## Key Takeaways

> A Saga coordinates a multi-service workflow through a sequence of local transactions, each with a compensating action to undo it on failure. It avoids distributed locks and 2PC at the cost of eventual consistency. Choreography (event-driven) is decentralized and scales well; orchestration (command-driven) provides clearer control and observability. Reliable event delivery via the Outbox Pattern and idempotent handlers are essential for saga correctness.
