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

### Compatibility Examples

**Backward compatible** — new consumer reads old events (adding an optional field):

```typescript
// v1 event produced by old system
const v1Event = {
  orderId: "abc",
  totalAmount: 100,
};

// v2 consumer reads both v1 and v2 — safe because the new field is optional
interface OrderCreatedV2 {
  orderId: string;
  totalAmount: number;
  discountCode?: string;       // new optional field
}

// Upcast function handles the missing field
function handleOrderCreated(event: OrderCreatedV2): void {
  // v1 events have no discountCode — defaults to undefined
  if (event.discountCode) {
    applyDiscount(event.discountCode);
  }
}
```

**Forward compatible** — old consumer reads new events (ignoring unknown fields):

```typescript
// v2 event produced by new system
const v2Event = {
  orderId: "abc",
  totalAmount: 100,
  discountCode: "WELCOME10",  // new field
  loyaltyTier: "gold",        // another new field
};

// v1 consumer reads both v1 and v2 — safe because it ignores unknown fields
interface OrderCreatedV1 {
  orderId: string;
  totalAmount: number;
  // no discountCode or loyaltyTier — unknown fields are ignored
}

// Tolerant reader — deserialize only the fields we know
function parseOrderCreated(raw: Record<string, unknown>): OrderCreatedV1 {
  return {
    orderId: String(raw.orderId),
    totalAmount: Number(raw.totalAmount),
    // unknown fields (discountCode, loyaltyTier) are silently dropped
  };
}
```

**Breaking change handled via new event type** — renaming a field requires a new type, not a new version:

```typescript
// Old event — cannot rename `totalAmount` to `amount` in the same type
interface OrderCreatedV1 {
  orderId: string;
  totalAmount: number;
}

// Instead, create a new event type
interface OrderCreatedV2 {
  orderId: string;
  amount: number;              // renamed from totalAmount
  discountCode?: string;
}

// Upcast transforms V1 into V2
function upcastToV2(event: OrderCreatedV1): OrderCreatedV2 {
  return {
    orderId: event.orderId,
    amount: event.totalAmount,  // map old field to new name
  };
}
```

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

## End-to-End Flow: Outbox -> SQS -> Consumer

Versioning in a system where events flow through an outbox table to SQS and then to consumers. SQS is schema-agnostic — it transports JSON without inspecting it. The version contract is between producer and consumer.

### Flow

```text
Order Service                Outbox Table                SQS Queue              Email Service
     │                           │                         │                        │
     │  Prisma $transaction       │                         │                        │
     │  write order + event (v2) │                         │                        │
     │──────────────────────────►│                         │                        │
     │                           │                         │                        │
     │                           │  Outbox poller          │                        │
     │                           │  reads event envelope   │                        │
     │                           │  (event_type, version,  │                        │
     │                           │   payload)              │                        │
     │                           │────────────────────────►│                        │
     │                           │                         │  SQS Consumer          │
     │                           │                         │  receives envelope     │
     │                           │                         │───────────────────────►│
     │                           │                         │                        │
     │                           │                         │       check version     │
     │                           │                         │       if v1: upcast    │
     │                           │                         │       process payload  │
```

### Producer — Write to Outbox

The event envelope with `version` is stored alongside the business data in a single Prisma transaction:

```typescript
async function createOrder(input: CreateOrderInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Business data
    const order = await tx.order.create({ data: { customerId: input.customerId } });

    // 2. Outbox event with version
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'order',
        aggregateId: order.id,
        eventType: 'OrderCreated',
        version: 2,
        payload: {
          orderId: order.id,
          totalAmount: order.totalAmount,
          discountCode: input.discountCode, // added in v2
        },
      },
    });
  });
}
```

### Outbox Poller — Publish to SQS

The poller reads unprocessed events and publishes the entire envelope to SQS. The envelope includes `version` so the consumer knows how to interpret the payload:

```typescript
async function publishOutboxEvents(): Promise<void> {
  const events = await prisma.outboxEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  for (const event of events) {
    await sqs.sendMessage({
      QueueUrl: process.env.SQS_QUEUE_URL!,
      MessageBody: JSON.stringify({
        eventType: event.eventType,
        version: event.version,
        aggregateId: event.aggregateId,
        payload: event.payload,
      }),
    });

    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }
}
```

### Consumer — Receive from SQS, Handle Versioning

The Email Service receives the envelope and decides how to interpret it based on `version`. Two common strategies:

**Tolerant reader** — for backward-compatible changes (new optional fields), ignore unknown fields:

```typescript
interface EmailNotification {
  orderId: string;
  totalAmount: number;
  // discountCode ignored — Email Service doesn't need it
}

async function handleSqsMessage(message: SQSMessage): Promise<void> {
  const raw = JSON.parse(message.Body!);
  if (raw.eventType !== 'OrderCreated') return;

  const payload = raw.payload as EmailNotification;
  await sendOrderConfirmation(payload.orderId, payload.totalAmount);
}
```

**Upcast function** — for breaking changes (renamed fields), check version and transform:

```typescript
interface EmailNotification {
  orderId: string;
  totalAmount: number;
}

async function handleSqsMessage(message: SQSMessage): Promise<void> {
  const raw = JSON.parse(message.Body!);
  if (raw.eventType !== 'OrderCreated') return;

  const event = upcastOrderCreated(raw.version, raw.payload);
  await sendOrderConfirmation(event.orderId, event.totalAmount);
}

function upcastOrderCreated(
  version: number,
  payload: Record<string, unknown>
): EmailNotification {
  if (version === 1) {
    return {
      orderId: payload.orderId as string,
      totalAmount: payload.totalAmount as number,
    };
  }
  if (version === 2) {
    // v2 renamed totalAmount -> amount
    return {
      orderId: payload.orderId as string,
      totalAmount: payload.amount as number,
    };
  }
  throw new Error(`Unknown version: ${version}`);
}
```

### Idempotency on Top

SQS delivers at-least-once — the same message may arrive multiple times. The consumer adds idempotency before processing:

```typescript
async function handleSqsMessage(message: SQSMessage): Promise<void> {
  // Deduplicate by SQS MessageId or a custom idempotency key
  const existing = await prisma.processedMessage.findUnique({
    where: { messageId: message.MessageId },
  });
  if (existing) return; // already processed

  const raw = JSON.parse(message.Body!);
  const event = upcastOrderCreated(raw.version, raw.payload);

  await prisma.$transaction(async (tx) => {
    await tx.processedMessage.create({
      data: { messageId: message.MessageId! },
    });
    await sendOrderConfirmation(event.orderId, event.totalAmount);
  });
}
```

### Key Insight

SQS does not enforce schema — the version contract is **between the producer and the consumer only**. The `version` field in the envelope enables **schema-on-read**: the producer writes whatever payload it wants, and each consumer decides how to interpret it. One producer, many consumers — each can process at their own version tolerance level.

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
- [Idempotency](idempotency.md) — deduplicating SQS messages before processing versioned events
- [CQRS](cqrs.md) — projections build read models from versioned events

---

## Key Takeaways

> Event versioning decouples producers and consumers by making schema changes explicit. Additive changes (new optional fields) are backward compatible and safe. Breaking changes (renames, type changes) require new event types. An upcast function transforms old event versions into the latest schema. Every event-driven system should define a compatibility strategy before the first event is published.
