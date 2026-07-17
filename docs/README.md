# Architecture Concepts

A collection of architectural patterns, technologies, and design concepts — each documented with a consistent structure for quick understanding and interview preparation.

---

## Index

### Distributed Systems Fundamentals

| Concept | Description |
|---------|-------------|
| [Distributed Systems](distributed-systems.md) | Collection of independent services collaborating over a network to function as a single system. |
| [CAP Theorem](cap-theorem.md) | Consistency, Availability, Partition Tolerance — the fundamental distributed systems trade-off. |
| [Distributed Transactions](distributed-transactions.md) | Two-Phase Commit and coordination strategies for atomicity across services. |
| [Delivery Semantics](delivery-semantics.md) | At-most-once, at-least-once, and exactly-once guarantees for message processing. |

### Event-Driven Architecture

| Concept | Description |
|---------|-------------|
| [Event-Driven Architecture](event-driven-architecture.md) | Loose coupling through event production and consumption across services. |
| [Outbox Pattern](outbox-pattern.md) | Ensures reliable event delivery by writing events to a DB table within the same transaction as business data. |
| [Saga Pattern](saga-pattern.md) | Sequence of local transactions with compensating actions for multi-service workflows. |
| [CQRS](cqrs.md) | Separating read and write models for independent optimisation and scaling. |
| [Event Sourcing](event-sourcing.md) | Append-only event store as source of truth with replayable projections. |

### Resilience & Reliability

| Concept | Description |
|---------|-------------|
| [Idempotency](idempotency.md) | Safe retries via idempotency keys to prevent duplicate side effects. |
| [Circuit Breaker](circuit-breaker.md) | Detects failures and stops calling degraded services to prevent cascading failures. |
| [Claim-Check Pattern](claim-check-pattern.md) | Database row-level locking to claim messages for exactly-once consumer processing. |
| [Distributed Lock](distributed-lock.md) | Mutual exclusion across services using Redis or database-based locks. |

### Data & Concurrency

| Concept | Description |
|---------|-------------|
| [Database Concurrency Control](database-concurrency-control.md) | Transactions, atomic operations, optimistic and pessimistic locking for safe concurrent data access. |

### Node.js / JavaScript

| Concept | Description |
|---------|-------------|
| [Concurrency vs Parallelism](concurrency-vs-parallelism.md) | Distinguishes dealing with many tasks from executing them simultaneously in Node.js. |
| [Event Loop](event-loop.md) | Node.js event loop phases, microtask/macrotask ordering, and phase behaviour. |
| [Promise APIs](promise-apis.md) | Coordinating multiple async operations with Promise.all, allSettled, race, and any. |
| [Cancellation & Timeouts](cancellation-timeouts.md) | AbortController, AbortSignal, and timeout patterns for async operations. |
| [Error Handling (Express)](error-handling.md) | Centralized async error middleware for consistent error responses. |

### Operational Patterns

| Concept | Description |
|---------|-------------|
| [Graceful Shutdown](graceful-shutdown.md) | Handling SIGINT/SIGTERM to drain consumers, close connections, and exit cleanly. |
| [Distributed Tracing](distributed-tracing.md) | Tracking requests across service boundaries with OpenTelemetry. |

### Reference Architecture

| Concept | Description |
|---------|-------------|
| [Practical Project](practical-project.md) | Reference e-commerce architecture applying all patterns in a real distributed system. |

---

## Template

New concepts should follow the structure defined in [`_template.md`](_template.md).

### Required Sections

| Section | Purpose |
|---------|---------|
| **What is it?** | Definition and core idea |
| **Problem** | What problem it solves |
| **Example** | Quick practical example |
| **Architecture / Flow** | Diagram or request flow |
| **How it Works** | Step-by-step lifecycle |
| **Advantages** | Benefits |
| **Trade-offs** | Downsides or costs |
| **When to Use** | Appropriate use cases |
| **When NOT to Use** | Alternatives |
| **Related Concepts** | Linked patterns/technologies |
| **Key Takeaways** | Summary for quick recall |

---

## Contributing

To add a new concept:

1. Copy `_template.md` to `<concept-name>.md`
2. Fill in each section
3. Add an entry to the index table above
