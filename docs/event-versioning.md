# Event Versioning & Schema Evolution

> Strategies for evolving event schemas without breaking existing consumers or producers.

---

## What is it?

**Event versioning** is the practice of assigning a version to each event schema and using a compatibility strategy to allow producers and consumers to evolve independently. **Schema evolution** is the ability to change event shapes over time while maintaining backward or forward compatibility.

When services publish events that other services consume, the producer may add fields, remove fields, or change types over time. Without versioning, a schema change in the producer breaks every consumer — even if the consumer never uses that field.

---

## Problem

Consider this event:

```typescript
interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
  totalAmount: number;
  createdAt: Date;
}
```

Later, the producer adds a `discountCode` field. Consumers written against the old schema do not know about `discountCode` and may:

- **Fail to parse** — strict deserializers throw on unknown fields
- **Silently skip** — fields are ignored, but the consumer misses the discount
- **Crash on type change** — if `totalAmount` changes from `number` to `string`, existing consumers break

Without a versioning strategy, producers cannot add fields or change types without coordinating a simultaneous deploy of every consumer.

---

## Example

**Without versioning** — a breaking change:

```typescript
// v1: OrderCreatedEvent
{ orderId: "abc", totalAmount: 99.99 }

// v2: totalAmount changed to a string (breaking)
{ orderId: "abc", totalAmount: "99.99" }
```

**With versioning** — add `version` to the envelope:

```typescript
interface EventEnvelope {
  eventType: string;
  version: number;          // <-- version number
  aggregateId: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

// v1
{ eventType: "OrderCreated", version: 1, aggregateId: "abc", payload: { totalAmount: 99.99 } }

// v2 — added discountCode, old consumers ignore it (backward compatible)
{ eventType: "OrderCreated", version: 2, aggregateId: "abc", payload: { totalAmount: 99.99, discountCode: "WELCOME" } }
```

Consumers check `version` and apply an **upcast function** to transform v1 payloads into v2 format:

```typescript
function upcastOrderCreated(event: EventEnvelope): OrderCreatedV2 {
  const payload = event.payload as any;

  switch (event.version) {
    case 1:
      return {
        orderId: event.aggregateId,
        totalAmount: payload.totalAmount,
        discountCode: null,              // v1 has no discount
        createdAt: event.timestamp,
      };
    case 2:
      return {
        orderId: event.aggregateId,
        totalAmount: payload.totalAmount,
        discountCode: payload.discountCode,
        createdAt: event.timestamp,
      };
    default:
      throw new Error(`Unknown version: ${event.version}`);
  }
}
```

---

## Architecture / Flow

```text
Producer                        Event Store                     Consumer
  │                                 │                              │
  │  OrderCreated (v1)              │                              │
  │────────────────────────────────►│                              │
  │                                 │                              │
  │  OrderCreated (v2, new field)   │                              │
  │────────────────────────────────►│                              │
  │                                 │    Load events               │
  │                                 │─────────────────────────────►│
  │                                 │    [v1, v2]                  │
  │                                 │                              │
  │                                 │    Upcast v1 → v2            │
  │                                 │    Upcast v2 → v2            │
  │                                 │    Process as v2             │
```

---

## Compatibility Strategies

| Strategy | What It Means | Use When |
|----------|---------------|----------|
| **Backward compatible** | Consumers written for schema N+1 can read events written with schema N | Default — safe for all deployments |
| **Forward compatible** | Consumers written for schema N can read events written with schema N+1 | Rolling deploys where old consumers must handle new producers |
| **Full compatible** | Both directions work simultaneously | When producers and consumers deploy independently |

### Backward Compatible Rules (new code reads old data)

- Can **add** optional fields — old data lacks them, new code defaults to null or a sensible default
- Can **remove** fields — old data may still have them, new code ignores them
- Cannot **rename** fields — new code looks for the new name, old data has the old name
- Cannot **change** field types — old data has the old type, new code expects the new type

### Forward Compatible Rules (old code reads new data)

- Can **add** optional fields — new data includes them, old code ignores unknown fields
- Cannot **remove** fields — old code expects them, new data does not have them
- Cannot **rename** fields — old code looks for the old name, new data has the new name
- Cannot **change** field types — old code expects old type, new data has new type

### Full Compatible Rules

- Only additive changes to optional fields
- No removals, no renames, no type changes

---

## How it Works

1. Producer assigns a `version` number to each event when publishing
2. Events are stored with their version in the event store (e.g., `event_data` JSONB includes `version`)
3. Consumer loads the event and checks the version
4. If the consumer's expected version is higher, an **upcast function** transforms the event to the latest schema
5. The consumer processes the event as if it were the latest version
6. For major changes (renames, type changes), emit a **new event type** instead of modifying the existing one

---

## New Event Type vs New Version

When the change is **additive** (new optional field), bump the version within the same event type:

```text
OrderCreated v1 → OrderCreated v2 (added discountCode)
```

When the change is **breaking** (rename, type change, semantic change), create a new event type:

```text
OrderCreated → OrderCreatedV2
```

Consumers that want the new shape subscribe to the new type. Old consumers continue with the old type.

---

## Schema Registry

A centralised schema registry stores the canonical schema for each event type and version. Producers validate before publishing; consumers validate after loading.

```text
Producer ──► Schema Registry ──► Event Store ──► Consumer
  │                │                                  │
  │  validate      │  check compatibility             │  validate
  │  before        │  (backward/forward/full)         │  before
  │  publish       │                                  │  processing
```

Popular registries: Confluent Schema Registry (Kafka), AWS Glue Schema Registry, custom Postgres table.

---

## Advantages

- **Independent deployment** — producers and consumers deploy at different times without coordination
- **Audit trail** — versioned events preserve the exact shape at the time of emission
- **Replay safety** — replaying old events still works because upcast functions handle older versions
- **Clear contract** — version numbers and compatibility rules make the event contract explicit

---

## Trade-offs

- **Complexity** — upcast functions add code to maintain for every version
- **Storage overhead** — versioned events may store fields that new consumers never use
- **Testing burden** — must test against every version you support
- **Registry dependency** — schema registry adds an operational dependency

---

## When to Use

- Any event-driven system with more than one producer or consumer
- Systems where services deploy independently and cannot coordinate schema changes
- Event sourcing where events must be replayable years later
- Multi-team systems where event producers and consumers are owned by different teams

---

## When NOT to Use

- Single-service, single-consumer systems where you control both ends
- Request-response APIs (versioned HTTP responses use API versioning instead)
- Systems where you can afford to upgrade all consumers atomically

---

## Related Concepts

- [Event Sourcing](event-sourcing.md) — append-only event store where versioned events are the source of truth
- [Outbox Pattern](outbox-pattern.md) — publishing versioned events reliably after a database write
- [Delivery Semantics](delivery-semantics.md) — consumers must handle at-least-once delivery of versioned events
- [CQRS](cqrs.md) — projections build read models from versioned events

---

## Key Takeaways

> Event versioning decouples producers and consumers by making schema changes explicit. Additive changes (new optional fields) are backward compatible and safe. Breaking changes (renames, type changes) require new event types. An upcast function transforms old event versions into the latest schema. Every event-driven system should define a compatibility strategy before the first event is published.
