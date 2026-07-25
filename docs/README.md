# Architecture Concepts

A collection of architectural patterns, technologies, and design concepts — each documented with a consistent structure for quick understanding and interview preparation.

---

## Index

### Study Plans

| Plan | Description |
|------|-------------|
| [Interview Study Roadmap](interview-study-roadmap.md) | Progressive learning path from Node.js fundamentals to distributed event-driven systems — 9 phases, 36 steps. |
| [2-Day Study Plan](2-day-study-plan.md) | Intensive 2-day interview prep covering runtime, data, events, resilience, operations, testing, and capstone walkthrough. |

### Distributed Systems Fundamentals

| Concept | Description |
|---------|-------------|
| [Distributed Systems](distributed-systems.md) | Collection of independent services collaborating over a network to function as a single system. |
| [CAP Theorem](cap-theorem.md) | Consistency, Availability, Partition Tolerance — the fundamental distributed systems trade-off. |
| [Distributed Transactions](distributed-transactions.md) | Two-Phase Commit and coordination strategies for atomicity across services. |
| [Delivery Semantics](delivery-semantics.md) | At-most-once, at-least-once, and exactly-once guarantees for message processing. |
| [Consistency Models](consistency-models.md) | Strong, eventual, causal, and other consistency guarantees for distributed data stores. |
| [Consensus Algorithms](consensus-algorithms.md) | Raft, Paxos, and how distributed nodes agree on a single value despite failures. |
| [gRPC](grpc.md) | High-performance RPC using Protocol Buffers and HTTP/2 for typed, streaming inter-service communication. |

### Event-Driven Architecture

| Concept | Description |
|---------|-------------|
| [Event-Driven Architecture](event-driven-architecture.md) | Loose coupling through event production and consumption across services. |
| [Message Queues](message-queues.md) | Kafka, RabbitMQ, SQS, and BullMQ — topologies, ordering, consumer groups, dead-letter queues. |
| [Outbox Pattern](outbox-pattern.md) | Ensures reliable event delivery by writing events to a DB table within the same transaction as business data. |
| [Saga Pattern](saga-pattern.md) | Sequence of local transactions with compensating actions for multi-service workflows. |
| [CQRS](cqrs.md) | Separating read and write models for independent optimisation and scaling. |
| [Event Sourcing](event-sourcing.md) | Append-only event store as source of truth with replayable projections. |
| [Event Versioning](event-versioning.md) | Strategies for evolving event schemas without breaking existing consumers or producers. |
| [Polling Strategies](polling-strategies.md) | Short and long polling for consuming messages and real-time data — SQS, outbox pollers, HTTP long poll. |

### Resilience & Reliability

| Concept | Description |
|---------|-------------|
| [Idempotency](idempotency.md) | Safe retries via idempotency keys to prevent duplicate side effects. |
| [Circuit Breaker](circuit-breaker.md) | Detects failures and stops calling degraded services to prevent cascading failures. |
| [Claim-Check Pattern](claim-check-pattern.md) | Database row-level locking to claim messages for exactly-once consumer processing. |
| [Distributed Lock](distributed-lock.md) | Mutual exclusion across services using Redis or database-based locks. |
| [Retry Pattern](retry-pattern.md) | Exponential backoff and jitter for resilient retries after transient failures. |
| [Rate Limiting](rate-limiting.md) | Token bucket, sliding window, and other algorithms to control request rates. |
| [Bulkhead Pattern](bulkhead-pattern.md) | Isolating connection pools and queues to prevent cascading resource exhaustion. |
| [Backpressure](backpressure.md) | Flow control that slows producers when consumers cannot keep up. |
| [Handling Eventual Consistency](handling-eventual-consistency.md) | Strategies for accepting staleness — read-your-writes, idempotency, sagas, CRDTs, UI patterns. |

### Data & Concurrency

| Concept | Description |
|---------|-------------|
| [Database Concurrency Control](database-concurrency-control.md) | Transactions, atomic operations, optimistic and pessimistic locking for safe concurrent data access. |
| [Database Migrations](database-migrations.md) | Zero-downtime schema changes using expand-migrate-contract pattern. |
| [Caching Strategies](caching-strategies.md) | Cache-aside, write-through, write-behind, multi-level caching, invalidation, and stampede prevention. |
| [Consistent Hashing](consistent-hashing.md) | Ring-based hashing that minimises key remapping when nodes join or leave. |
| [Replication](replication.md) | Single-leader, multi-leader, and synchronous/asynchronous replication strategies. |
| [Sharding](sharding.md) | Horizontal partitioning of data across independent databases for scale. |
| [MySQL Scaling](mysql-scaling.md) | Progression from single instance to millions of users — replicas, caching, connection pooling, sharding. |

### Node.js / JavaScript

| Concept | Description |
|---------|-------------|
| [Concurrency vs Parallelism](concurrency-vs-parallelism.md) | Distinguishes dealing with many tasks from executing them simultaneously in Node.js. |
| [Event Loop](event-loop.md) | Node.js event loop phases, microtask/macrotask ordering, and phase behaviour. |
| [Promise APIs](promise-apis.md) | Coordinating multiple async operations with Promise.all, allSettled, race, and any. |
| [Cancellation & Timeouts](cancellation-timeouts.md) | AbortController, AbortSignal, and timeout patterns for async operations. |
| [Error Handling (Express)](error-handling.md) | Centralized async error middleware for consistent error responses. |
| [Connection Pooling](connection-pooling.md) | Managing database and HTTP connection pools for latency reduction, resource control, and exhaustion prevention. |
| [Node.js Runtime Architecture](nodejs-runtime.md) | V8, libuv, C++ bindings, and the core JS library — how they compose to run async JavaScript on the server. |
| [Node.js Event Emitter](nodejs-event-emitter.md) | The observer pattern at the heart of Node.js — EventEmitter API, listeners, memory management, and built-in usage. |
| [Node.js Race Conditions](nodejs-race-conditions.md) | Logic-level race conditions caused by async interleaving on the single thread — patterns, prevention, and decision guide. |

### Operational Patterns

| Concept | Description |
|---------|-------------|
| [Graceful Shutdown](graceful-shutdown.md) | Handling SIGINT/SIGTERM to drain consumers, close connections, and exit cleanly. |
| [Distributed Tracing](distributed-tracing.md) | Tracking requests across service boundaries with OpenTelemetry. |
| [Service Discovery](service-discovery.md) | How services find each other dynamically via registries and DNS. |
| [Leader Election](leader-election.md) | Selecting one node as coordinator using leases or consensus. |
| [Rollout Strategies](rollout-strategies.md) | Feature flags, canary releases, and percentage rollouts for safe deployments. |
| [API Versioning](api-versioning.md) | Strategies for evolving HTTP APIs without breaking existing clients. |

### Testing & Quality

| Concept | Description |
|---------|-------------|
| [Testing Event-Driven Systems](testing-event-driven-systems.md) | Unit, integration, and contract testing strategies for handlers, projections, idempotency, and outbox. |

### Reference Architecture

| Concept | Description |
|---------|-------------|
| [Practical Project](practical-project.md) | Reference e-commerce architecture applying all patterns in a real distributed system. |
| [Interview Study Roadmap](interview-study-roadmap.md) | Progressive learning path from Node.js fundamentals to distributed event-driven systems. |

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
