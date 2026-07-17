# Event-Driven Architecture

> An architectural style where services communicate by producing and consuming events — enabling loose coupling, asynchronous processing, and real-time reactivity.

---

## What is it?

**Event-Driven Architecture (EDA)** is a design paradigm in which services publish events when something noteworthy happens (e.g. `OrderPlaced`, `PaymentReceived`), and other services subscribe to those events and react accordingly. The publisher does not know which services consume the event — it only knows that the event was published.

EDA is the foundation for the [Outbox Pattern](outbox-pattern.md), [Saga Pattern](saga-pattern.md), [CQRS](cqrs.md), and [Event Sourcing](event-sourcing.md) — each of these is a specific implementation pattern within an event-driven system.

Three core concepts:

| Concept | Description |
|---------|-------------|
| **Event** | A record of something that happened in the past (e.g. `OrderShipped`, `InventoryReserved`). Immutable, named in past tense. |
| **Producer** | The service that detects the event and publishes it. Does not know who consumes it. |
| **Consumer** | The service that subscribes to events and reacts. Does not know who produced it. |

---

## Problem

In a synchronous request-response architecture (REST, gRPC), services are tightly coupled:

- A service must know the address of every downstream service it depends on.
- If a downstream service is slow or unavailable, the caller blocks or fails.
- Adding a new consumer of an operation means modifying the producer's code.
- Broadcasting an event to multiple consumers requires the producer to call each one — fan-out logic leaks into every service.

This coupling limits scalability, resilience, and team autonomy.

---

## Example

### Event Types

Events fall into two categories:

```text
Domain Event:
  The order service publishes "OrderPlaced" — an event that happened in its domain.
  It contains: { orderId, customerId, items, total }
  Consumers decide what to do: inventory reserves stock, payment charges, notification sends email.

Event Notification (lightweight):
  "OrderPlaced" with only { orderId } — consumers must fetch the full data from the producer's API.
  Pros: small payload, less coupling to event schema.
  Cons: extra round-trip per consumer, higher latency.

Event-Carried State Transfer (fat event):
  "OrderPlaced" with { orderId, customerId, items, total, shippingAddress } — everything the consumer needs.
  Pros: consumers are self-sufficient, no extra API calls.
  Cons: larger events, more coupling to data shape.
```

### Publishing Events with a Message Broker

```typescript
import { SNS } from 'aws-sdk';

const sns = new SNS();

async function publishOrderPlaced(order: Order) {
  const event = {
    eventType: 'OrderPlaced',
    eventVersion: '1.0',
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    data: {
      orderId: order.id,
      customerId: order.customerId,
      items: order.items,
      total: order.total,
    }
  };

  await sns.publish({
    TopicArn: process.env.ORDER_EVENTS_TOPIC!,
    Message: JSON.stringify(event),
    MessageAttributes: {
      eventType: { DataType: 'String', StringValue: event.eventType }
    }
  }).promise();
}
```

### Consuming Events (Routing by Type)

```typescript
import { SQS } from 'aws-sdk';

const sqs = new SQS();

async function handleOrderEvent(message: SQS.Message) {
  const event = JSON.parse(message.Body!);

  switch (event.eventType) {
    case 'OrderPlaced':
      await reserveInventory(event.data);
      break;
    case 'PaymentConfirmed':
      await updateOrderStatus(event.data.orderId, 'confirmed');
      break;
    case 'OrderShipped':
      await notifyCustomer(event.data);
      break;
    default:
      console.warn(`Unknown event type: ${event.eventType}`);
  }
}
```

### Event Schema and Versioning

As events evolve, the schema must change without breaking consumers:

```typescript
// Event version 1.0
{
  eventType: 'OrderPlaced',
  eventVersion: '1.0',
  data: { orderId: '123', total: 99.99 }
}

// Event version 2.0 — added currency field
{
  eventType: 'OrderPlaced',
  eventVersion: '2.0',
  data: { orderId: '123', total: 99.99, currency: 'USD' }
}

// Consumer handles both versions
async function handleOrderPlaced(event: OrderEvent) {
  const { orderId, total, currency } = event.data;
  const amount = {
    value: total,
    currency: currency ?? 'USD' // default for old events
  };
  // ...
}
```

---

## Architecture / Flow

```text
┌──────────────────────────────────────────────────────────────┐
│                    Event Bus / Message Broker                  │
│         (SNS / SQS / Kafka / RabbitMQ / EventBridge)          │
│                                                               │
│    OrderPlaced ──► Inventory Service (reserve)                │
│    OrderPlaced ──► Payment Service (charge)                   │
│    OrderPlaced ──► Analytics Service (record)                │
│    OrderPlaced ──► Notification Service (email)              │
│                                                               │
│    PaymentConfirmed ──► Order Service (confirm status)        │
│    PaymentConfirmed ──► Analytics Service (update revenue)    │
└──────────────────────────────────────────────────────────────┘
         ▲                                      │
         │                                      │
    ┌────┴─────┐                     ┌──────────▼──────────┐
    │ Producer │                     │      Consumers       │
    │ (Order   │                     │  (Inventory, Payment │
    │  Service)│                     │   Analytics, Notif.) │
    └──────────┘                     └─────────────────────┘
```

---

## How it Works

1. A producer detects a state change (e.g. "order was placed") and creates an event describing what happened.
2. The producer publishes the event to a message broker (SNS, Kafka, RabbitMQ, EventBridge) — either directly or via the [Outbox Pattern](outbox-pattern.md) for reliability.
3. The broker distributes the event to all subscribed consumers (fan-out for topics, competing-consumers for queues).
4. Each consumer processes the event independently — they may update their database, call an external API, or publish new events.
5. Consumers acknowledge the event after successful processing. If processing fails, the broker redelivers the event (at-least-once semantics).
6. Producers and consumers remain fully decoupled — new consumers can subscribe without changing the producer.

---

## Advantages

| Advantage | Impact |
|-----------|--------|
| **Loose coupling** — producers do not know about consumers | Services can evolve and deploy independently |
| **Scalability** — consumers can scale independently based on their own load | High-volume consumers can have more instances |
| **Resilience** — a slow or failing consumer does not affect the producer | The producer publishes once and moves on |
| **Fan-out** — one event can trigger multiple actions without modifying the producer | Adding a new feature (e.g. analytics tracking) means adding a new consumer, not changing existing code |
| **Audit trail** — the event stream provides a record of everything that happened | Useful for debugging, compliance, and replay |

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Eventual consistency** — consumers see events after a delay, not immediately | Applications must tolerate stale reads and asynchronous updates |
| **Event schema evolution** — changing an event's shape can break consumers | Requires careful versioning, backward compatibility, and consumer coordination |
| **Debugging complexity** — a single request may trigger a chain of events across multiple services | Requires [Distributed Tracing](distributed-tracing.md) and event-scoped logging |
| **Delivery guarantees** — brokers provide at-least-once delivery; exactly-once requires [Idempotency](idempotency.md) on consumers | All consumers must handle duplicates |
| **Event ordering** — messages may arrive out of order in a partitioned or multi-consumer setup | Require sequence numbers, version vectors, or single-partition ordering (Kafka) |

---

## When to Use

- Systems with multiple services that need to react to the same events (e.g. order placed → inventory, payment, notification, analytics)
- Workflows that can be processed asynchronously — the producer does not need an immediate response
- Systems that need to scale read and write workloads independently
- Architectures where team autonomy and independent deployability are priorities
- Real-time or near-real-time processing (fraud detection, monitoring, personalisation)

---

## When NOT to Use

- Simple CRUD applications where synchronous request-response is sufficient
- Workflows that require immediate, synchronous consistency (e.g. "place order and get back the tracking number in the same response")
- Systems with very low event volume where the overhead of a message broker is not justified
- Teams that are not equipped to handle eventual consistency, duplicate events, and asynchronous debugging

---

## Related Concepts

- [Outbox Pattern](outbox-pattern.md) — reliably publishes events from the producer's database transaction
- [Saga Pattern](saga-pattern.md) — coordinates multi-step workflows using events in a choreography style
- [CQRS](cqrs.md) — the event bus drives read model projections from the write side
- [Event Sourcing](event-sourcing.md) — events are the primary store, not just a communication mechanism
- [Delivery Semantics](delivery-semantics.md) — EDA typically uses at-least-once delivery with idempotent consumers
- [Distributed Tracing](distributed-tracing.md) — traces follow events across services for debugging
- [Distributed Systems](distributed-systems.md) — EDA is a communication pattern within distributed architectures
- Message Broker (SNS / SQS / Kafka / RabbitMQ / EventBridge)
- Event Schema Registry
- Event Versioning

---

## Key Takeaways

> Event-Driven Architecture decouples services through event production and consumption. Producers publish events without knowing who consumes them; consumers react without knowing who produced them. This enables loose coupling, independent scaling, and flexible fan-out — but requires handling eventual consistency, event schema evolution, and duplicate delivery. The Outbox, Saga, CQRS, and Event Sourcing patterns are all specialisations of the event-driven approach.
