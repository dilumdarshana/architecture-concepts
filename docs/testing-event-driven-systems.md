# Testing Event-Driven Systems

> Strategies for testing asynchronous, event-driven code — handlers, projections, idempotency, and integrations — without flaky or slow tests.

---

## What is it?

Testing event-driven systems requires techniques beyond standard unit and integration tests. Events are asynchronous, consumers process them at an unpredictable time, and side effects (DB writes, API calls, follow-up events) may not be visible immediately. The key patterns are: **unit-test handlers in isolation**, **integration-test with in-memory replacements**, **contract-test event schemas**, and **assert on side effects, not timing**.

---

## Problem

Event-driven code is hard to test:

- **Non-deterministic** — consumer processes at an unknown time, tests race against it
- **External dependencies** — message broker, database, downstream services
- **Cascading effects** — one event triggers another, making assertions complex
- **Idempotency edge cases** — duplicate delivery, crash mid-processing, retry storms
- **State reconstruction** — event-sourced aggregates require replaying events

---

## Testing Pyramid for Event-Driven Systems

```text
         /\
        /  \
       /    \
      / E2E  \       Few — full system with real broker + DB
     /────────\
    /          \
   / Integration \   Some — handler + real DB, in-memory broker
  /──────────────\
 /                \
/ Unit (handler)   \  Many — pure logic, no I/O
────────────────────
```

---

## Example

### 1. Unit Test — Command Handler (Pure Logic)

Test business logic without I/O by extracting pure functions:

```typescript
// handler.ts — inject dependencies
export class CreateTaskHandler {
  constructor(
    private readonly eventStore: EventStore,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateTaskCommand): Promise<string> {
    const id = randomUUID();
    const { event } = TaskAggregate.create(id, command.title);
    await this.eventStore.append(id, [event], 0);
    await this.eventBus.publish('TaskCreatedEvent', event);
    return id;
  }
}

// handler.test.ts — mock the event store and bus
import { CreateTaskHandler } from './handler';

describe('CreateTaskHandler', () => {
  it('appends a TaskCreatedEvent and returns the id', async () => {
    const eventStore = { append: vi.fn(), getEvents: vi.fn() };
    const eventBus = { publish: vi.fn(), subscribe: vi.fn() };

    const handler = new CreateTaskHandler(eventStore as any, eventBus as any);
    const id = await handler.execute(new CreateTaskCommand('Test task'));

    expect(id).toBeDefined();
    expect(eventStore.append).toHaveBeenCalledOnce();
    expect(eventBus.publish).toHaveBeenCalledWith(
      'TaskCreatedEvent',
      expect.objectContaining({ title: 'Test task' }),
    );
  });
});
```

### 2. Integration Test — Projection with Real Database

Test that a projection correctly updates the read model:

```typescript
describe('TaskCreatedProjection', () => {
  let readRepo: PgTaskReadRepository;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    readRepo = new PgTaskReadRepository(pool);
    await pool.query(`TRUNCATE task_view`);
  });

  it('inserts a row in task_view when handling TaskCreatedEvent', async () => {
    const projection = new TaskCreatedProjection(readRepo);
    const event = new TaskCreatedEvent(
      'task-1', 'Test', 'OPEN', new Date(),
    );

    await projection.handle(event);

    const task = await readRepo.findById('task-1');
    expect(task).toBeDefined();
    expect(task!.title).toBe('Test');
    expect(task!.status).toBe('OPEN');
  });
});
```

### 3. Contract Test — Event Shape

Verify event producers emit the correct schema:

```typescript
describe('CreateTaskHandler — event contract', () => {
  it('emits a TaskCreatedEvent with the expected payload', async () => {
    const eventStore = { append: vi.fn(), getEvents: vi.fn() };
    const eventBus = { publish: vi.fn(), subscribe: vi.fn() };

    const handler = new CreateTaskHandler(eventStore as any, eventBus as any);
    await handler.execute(new CreateTaskCommand('Test'));

    const event = eventBus.publish.mock.calls[0][1] as TaskCreatedEvent;
    expect(event.eventType).toBe('TaskCreatedEvent');
    expect(event.title).toBe('Test');
    expect(event.status).toBe('OPEN');
    expect(event.version).toBe(0);

    // schema validation
    const schema = { type: 'object', required: ['aggregateId', 'title', 'status', 'createdAt'] };
    expect(() => ajv.validate(schema, event)).not.toThrow();
  });
});
```

---

## Architecture / Flow

```text
Unit Tests                             Integration Tests
  │                                        │
  │  mock event store                     │  real DB (testcontainers)
  │  mock event bus                       │  in-memory event bus
  │  test handler logic                   │  test projection output
  │                                        │
  ▼                                        ▼
┌──────────────┐                  ┌──────────────────┐
│ Handler      │                  │ Projection       │
│ tests        │                  │ tests            │
└──────────────┘                  └──────────────────┘

E2E Tests (optional)
  │
  │  real broker (testcontainers)
  │  real DB (testcontainers)
  │  full flow: command → event store → event bus → projection → read DB
  ▼
┌──────────────────┐
│ Full system      │
│ end-to-end       │
└──────────────────┘
```

---

## Testing Patterns

### In-Memory Event Store

Replace PostgreSQL event store with an in-memory version for fast unit tests:

```typescript
export class InMemoryEventStore implements EventStore {
  private store = new Map<string, DomainEvent[]>();

  async append(aggregateId: string, events: DomainEvent[], expectedVersion: number): Promise<void> {
    const existing = this.store.get(aggregateId) || [];
    if (existing.length !== expectedVersion) {
      throw new Error('Concurrency conflict');
    }
    let version = expectedVersion;
    for (const event of events) {
      version++;
      (event as any).version = version;
      existing.push(event);
    }
    this.store.set(aggregateId, existing);
  }

  async getEvents(aggregateId: string): Promise<DomainEvent[]> {
    return this.store.get(aggregateId) || [];
  }
}
```

### Testing Idempotency

Verify that the second identical invocation returns the cached result:

```typescript
it('returns cached result when the same event is processed twice', async () => {
  const idempotencyStore = new InMemoryIdempotencyStore();
  const result1 = await processPayment(idempotencyStore, { idempotencyKey: 'key-1', amount: 100 });
  const result2 = await processPayment(idempotencyStore, { idempotencyKey: 'key-1', amount: 100 });

  expect(result1).toEqual(result2);
  expect(stripe.charges.create).toHaveBeenCalledTimes(1);
});
```

### Testing Outbox Pattern

Verify that events are written to the outbox table within the same transaction:

```typescript
it('writes event to outbox within the same transaction as business data', async () => {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: { /* ... */ } });
    await tx.outbox.create({
      data: { eventType: 'OrderCreated', payload: order }
    });
    return order;
  });

  const outboxEvents = await prisma.outbox.findMany();
  expect(outboxEvents).toHaveLength(1);
  expect(outboxEvents[0].eventType).toBe('OrderCreated');
});
```

### Testing Aggregate Replay (Event Sourcing)

```typescript
it('reconstructs state by replaying events', () => {
  const aggregate = new TaskAggregate();
  aggregate.replay([
    new TaskCreatedEvent('task-1', 'Test', 'OPEN', new Date('2025-01-01'), 1),
    new TaskStatusUpdatedEvent('task-1', 'IN_PROGRESS', new Date('2025-01-02'), 2),
  ]);

  const state = aggregate.getSnapshot()!;
  expect(state.title).toBe('Test');
  expect(state.status).toBe('IN_PROGRESS');
  expect(aggregate.stateVersion).toBe(2);
});
```

---

## Testcontainers for Integration Tests

Use Testcontainers to spin up real PostgreSQL and Redis for integration tests:

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

let pgContainer: PostgreSqlContainer;
let redisContainer: RedisContainer;

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer().start();
  redisContainer = await new RedisContainer().start();

  process.env.DATABASE_URL = pgContainer.getConnectionUri();
  process.env.REDIS_URL = redisContainer.getConnectionUri();
});

afterAll(async () => {
  await pgContainer.stop();
  await redisContainer.stop();
});
```

---

## How it Works

1. **Unit test handlers** — mock event store and event bus; test validation logic and event emission
2. **Unit test aggregates** — replay events, assert state is correctly reconstructed
3. **Integration test projections** — use a real database, fire events, assert read model updates
4. **Contract test events** — assert event shape, required fields, and types
5. **Test idempotency** — process the same event twice, assert side effects happen once
6. **Test outbox** — within a transaction, assert both business data and outbox event are written
7. **Test concurrent consumers** — simulate two consumers claiming the same message with `SKIP LOCKED`
8. **Test graceful shutdown** — send SIGTERM, assert in-flight work completes and resources close

---

## Advantages

- **Fast feedback** — unit tests run in milliseconds, no I/O
- **Deterministic** — in-memory replacements remove timing flakiness
- **Isolated failures** — each test layer identifies exactly where a bug lives
- **Refactoring safety** — contract tests catch accidental schema changes
- **Documentation** — tests serve as executable documentation of system behaviour

---

## Trade-offs

- **In-memory != real** — in-memory event store may miss concurrency edge cases of PostgreSQL
- **Test maintenance** — in-memory replacements must stay in sync with real implementations
- **Slow integration tests** — Testcontainers adds seconds to every test run
- **E2E complexity** — full system tests are expensive to write and maintain

---

## When to Use

- Every handler, projection, and aggregate — unit tests are fast and cheap
- Projections and repositories — integration test with a real database
- Event schema changes — contract test to catch breaking changes
- Idempotency logic — always test duplicate handling

---

## When NOT to Use

- Do not write E2E tests for every flow — they are slow and brittle
- Do not test the message broker itself (test your consumer, not RabbitMQ)
- Do not mock everything — integration tests with real storage catch bugs mocks miss

---

## Related Concepts

- [CQRS](cqrs.md) — test command and query handlers independently
- [Event Sourcing](event-sourcing.md) — test aggregate replay and projection rebuild
- [Outbox Pattern](outbox-pattern.md) — test that events are written atomically with business data
- [Idempotency](idempotency.md) — test duplicate delivery and retry safety
- [Delivery Semantics](delivery-semantics.md) — test at-least-once vs exactly-once behaviour

---

## Key Takeaways

> Test event-driven code in layers: unit test handlers with mocked dependencies, integration test projections with a real database, and contract test event schemas to catch breaking changes. Use in-memory replacements for the event store and event bus to keep unit tests fast and deterministic. Always test idempotency — process the same event twice and assert side effects happen once. Testcontainers provides real PostgreSQL/Redis instances for integration tests without manual setup.
