# Interview Study Roadmap

> A progressive learning path from Node.js fundamentals to building a distributed event-driven system — covering every concept in the [Architecture Concepts](README.md) library.

---

## How to Use This Roadmap

Each phase builds on the previous one. Study in order. For each doc:

1. Read the doc start to finish.
2. Memorise the **Key Takeaways** as your elevator pitch.
3. Trace the **Architecture / Flow** diagram with your own words.
4. Recite the **How it Works** numbered steps aloud.
5. Write the Node.js code example from memory.

---

## Phase 1: JavaScript Runtime Foundation

Before you can build anything, understand how Node.js runs your code.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 1 | [Event Loop](event-loop.md) | Called event loop "synchronous" | 6 phases (timers → pending → idle → poll → check → close), microtasks run between phases, CPU blocks all phases, `setImmediate` vs `setTimeout` vs `process.nextTick` | Every service in the architecture runs on the event loop — understanding phases prevents blocking and starvation |
| 2 | [Concurrency vs Parallelism](concurrency-vs-parallelism.md) | Conflated concurrency with single-threaded; could not articulate threads vs processes | Concurrency = managing many tasks (event loop + async I/O). Parallelism = doing many tasks at once (worker threads). Worker threads vs child processes table | Image resizing (product photos) and PDF invoice generation offloaded to worker threads while the event loop handles I/O |
| 3 | [Error Handling (Express)](error-handling.md) | Vague on async error patterns | `asyncHandler` wrapper catches rejected promises, centralized error middleware, custom error classes, never swallow errors | Every Express service uses `asyncHandler` + centralized error middleware for consistent error responses |
| 4 | [Promise APIs](promise-apis.md) | Weak async coordination | `Promise.all` (fail-fast), `Promise.allSettled` (tolerate partial failure), `Promise.race` (timeout), `Promise.any` (first success) | Dashboard uses `Promise.all` for parallel queries; Notification Service uses `Promise.allSettled` for batch email dispatch |

### Interview Checkpoint — Phase 1

> "Node.js runs a single-threaded event loop with 6 phases. I/O is non-blocking and concurrent — the loop initiates the operation and picks up the result later. CPU-bound work (image processing, JSON parsing) blocks every phase, so I offload it to `worker_threads` which run on separate cores for true parallelism. That's different from `child_process` which I use for running non-Node.js programs like ffmpeg. For error handling, I wrap every async route handler with an `asyncHandler` that catches rejected promises and forwards them to centralized error middleware."

---

## Phase 2: Distributed Systems Theory

Understand the trade-offs that define every distributed system.

| Step | Doc | Key Talking Points | Practical Project Connection |
|------|-----|-------------------|------------------------------|
| 5 | [CAP Theorem](cap-theorem.md) | Consistency vs Availability vs Partition Tolerance — pick 2 (actually pick CP or AP during a partition). Most distributed databases are CP (etcd, ZooKeeper) or AP (Cassandra, DynamoDB) | The e-commerce platform chooses **AP for notifications** (eventual consistency is fine) and **CP for inventory** (strong consistency to prevent overselling) |
| 6 | [Consistency Models](consistency-models.md) | Strong (linearizability), eventual, causal, read-after-write, monotonic reads. Strong is expensive — choose the weakest that works | Order Service uses strong consistency for inventory via `SELECT FOR UPDATE`. Notification Service uses eventual consistency — a user might see a stale notification briefly |
| 7 | [Consensus Algorithms](consensus-algorithms.md) | Raft decomposes into leader election, log replication, safety. Majority (2n+1) tolerates n failures. All writes go through the leader | etcd or Raft-based coordination for failover and cluster-wide configuration |
| 8 | [Delivery Semantics](delivery-semantics.md) | At-most-once (fast, loses messages), at-least-once (reliable, duplicates), exactly-once = at-least-once + idempotency | All services use at-least-once delivery via Bull/SQS. Payment Service upgrades to exactly-once via idempotency keys |

### Interview Checkpoint — Phase 2

> "The CAP theorem says you can have at most two of Consistency, Availability, and Partition Tolerance during a network partition. I partition my system: inventory operations are CP (strong consistency matters), while notifications are AP (eventual consistency is acceptable). Consensus algorithms like Raft solve agreement across nodes — etcd uses it for leader election and log replication. For message delivery, at-least-once is the practical default; I achieve exactly-once by adding idempotency at the consumer."

---

## Phase 3: Async Programming Patterns

Practical patterns for controlling async execution in production.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 9 | [Cancellation & Timeouts](cancellation-timeouts.md) | Vague on cancellation | AbortController + AbortSignal for cancelling DB queries on client disconnect, `AbortSignal.timeout()` for API timeouts, `Promise.race` with a timeout promise | HTTP routes use AbortController to cancel DB queries when the client disconnects; outbox publisher uses timeout to prevent hung pollers |
| 10 | [Graceful Shutdown](graceful-shutdown.md) | Could not describe in-flight tracking, keep-alive handling | Step-by-step shutdown lifecycle: register signal handlers → stop accepting connections → drain in-flight requests → close DB/queue connections → exit. K8s `terminationGracePeriodSeconds` | Every service implements signal handlers to drain queues, track in-flight requests, and close keep-alive sockets during rolling deployments |

### Interview Checkpoint — Phase 3

> "I use AbortController for cancellation — when a client disconnects, I abort the associated DB query so it doesn't waste connection pool slots. For timeouts, `AbortSignal.timeout(5000)` races against the operation. For graceful shutdown, I register SIGTERM handlers that stop accepting new requests, track in-flight work with a counter, drain keep-alive sockets, close database and queue connections, then exit. In Kubernetes, the whole sequence must fit within `terminationGracePeriodSeconds` or the pod is force-killed."

---

## Phase 4: Database & Data Layer

The data layer is the backbone of the system. Understand how to keep it correct and scalable.

| Step | Doc | Key Talking Points | Practical Project Connection |
|------|-----|-------------------|------------------------------|
| 11 | [Database Concurrency Control](database-concurrency-control.md) | ACID, isolation levels, atomic operations vs pessimistic vs optimistic locking, SELECT FOR UPDATE scenarios | Inventory Service uses pessimistic locking during flash sales; all services use transactions for atomic writes |
| 12 | [Distributed Transactions](distributed-transactions.md) | 2PC/XA — strong consistency across services at the cost of latency and availability. Usually avoided in microservices | Explicitly not used in the practical project — Saga + Outbox + Idempotency provide eventual consistency without 2PC overhead |
| 13 | [Saga Pattern](saga-pattern.md) | Sequence of local transactions with compensating actions. Choreography (event-driven) vs orchestration (command-driven) | Checkout flow coordinates Order, Payment, and Inventory services via choreographed Saga |
| 14 | [Replication](replication.md) | Single-leader (writes to one node, reads from replicas), multi-leader (writes anywhere, conflict resolution), synchronous vs async | PostgreSQL streaming replication for HA; read replicas serve analytics queries without impacting the primary |
| 15 | [Sharding](sharding.md) | Horizontal partitioning by shard key (customer_id, region). Range, hash, and consistent hash strategies. Cross-shard queries are expensive | Order data sharded by `customer_id` so each shard stays small and writes scale horizontally |
| 16 | [Consistent Hashing](consistent-hashing.md) | Ring-based hashing, virtual nodes, minimal key remapping on node changes | Redis Cluster uses consistent hashing for cache key distribution — adding a cache node moves only ~1/N of keys |

### Interview Checkpoint — Phase 4

> "For data correctness, I use Prisma `$transaction` for atomic multi-step writes. For high-contention resources like flash sale inventory, I use `SELECT FOR UPDATE` to pessimistically lock the row. For lower contention, optimistic locking with a version column avoids lock overhead. I avoid distributed transactions (2PC) — instead, I use the Saga pattern with compensating actions for multi-service workflows. For scaling, I shard by customer_id and replicate for read throughput. Consistent hashing is what Redis Cluster uses to distribute cache keys with minimal reshuffling when nodes change."

---

## Phase 5: Event-Driven Architecture

The heart of the system — how services communicate asynchronously.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 17 | [Event-Driven Architecture](event-driven-architecture.md) | Basic familiarity but lacked depth | Event production, event channels (message broker), event consumption. Loose coupling, scalability, eventual consistency | All services communicate through Bull/Redis message queue. Order Service publishes events; Notification and Analytics services consume them |
| 18 | [Outbox Pattern](outbox-pattern.md) | Knew the name but surface-level | Dual-write problem (write DB + publish event in one transaction), outbox table, poller/publisher, at-least-once delivery | Order Service publishes `OrderCreated`/`PaymentConfirmed` without dual-write risk — writes event to outbox table in same Prisma `$transaction`, then a poller publishes to BullMQ |
| 19 | [Event Sourcing](event-sourcing.md) | Not mentioned | Append-only event store as source of truth, replayable projections, audit trail, event versioning | Payment Service stores ledger as an append-only event stream — every charge, refund, and reversal is an event |
| 20 | [CQRS](cqrs.md) | Not mentioned | Separate read and write models. Commands go to the write model (optimised for writes), queries go to the read model (denormalised for fast reads) | Analytics Service maintains denormalised read models built from the event stream — one query, no joins |

### Interview Checkpoint — Phase 5

> "Services communicate asynchronously through event-driven architecture. The critical challenge is the dual-write problem — I solve it with the Outbox Pattern: within a single Prisma transaction, I write the business data and the event to an outbox table. A separate poller reads the outbox and publishes to BullMQ. This gives at-least-once delivery without distributed transactions. For the payment ledger, I use Event Sourcing — every financial operation is an append-only event, which gives a complete audit trail and the ability to replay state. For read performance, I use CQRS: the Analytics Service maintains denormalised read models that are built from the event stream and optimised for specific queries."

---

## Phase 6: Resilience Patterns

How the system survives failures without cascading.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 21 | [Idempotency](idempotency.md) | Described SQS alone, not the idempotency store | Idempotency key (client UUID), idempotency table (key + result), deduplication flow, email send-log pattern | Payment Service deduplicates charge requests on retry — checks idempotency key before calling Stripe |
| 22 | [Retry Pattern](retry-pattern.md) | Not mentioned | Exponential backoff (delay = base * 2^n), jitter (full/equal/decorrelated), max retries, dead letter queue | BullMQ workers use exponential backoff + jitter for payment and notification jobs |
| 23 | [Circuit Breaker](circuit-breaker.md) | Not mentioned | States: closed (normal) → open (failing fast) → half-open (probing). Error threshold, timeout window, fallback | Order Service wraps downstream Payment API calls with opossum — when Payment is degraded, it fails fast |
| 24 | [Rate Limiting](rate-limiting.md) | Not mentioned | Token bucket, sliding window, fixed window. 429 + Retry-After header | API Gateway enforces per-client rate limits with token bucket |
| 25 | [Bulkhead Pattern](bulkhead-pattern.md) | Not mentioned | Isolate connection pools per dependency. One slow service cannot exhaust shared resources | Each service has dedicated connection pools per downstream dependency |
| 26 | [Backpressure](backpressure.md) | Not mentioned | Producer must not outpace consumer. Bounded queues, stream `drain` events, consumer credits | Queue workers limit concurrency; streams use backpressure-aware piping |
| 27 | [Distributed Lock](distributed-lock.md) | Not mentioned | Mutual exclusion via Redis SET NX with TTL. try/finally release, lease renewal | Coordination across service instances for singleton jobs |
| 28 | [Claim-Check Pattern](claim-check-pattern.md) | Not mentioned | `SELECT ... FOR UPDATE SKIP LOCKED` for exactly-once consumer processing | Inventory Service uses `SELECT FOR UPDATE SKIP LOCKED` on reservation rows to prevent concurrent overselling |

### Interview Checkpoint — Phase 6

> "Resilience is layered. At the entry point, the API Gateway rate-limits clients with a token bucket — returning 429 when exceeded. Internally, each service has a Bulkhead — separate connection pools per dependency so a slow payment API cannot exhaust database connections. Calls to downstream services are wrapped in a Circuit Breaker that opens after 50% errors and probes for recovery in the half-open state. For retries, I use exponential backoff with full jitter so retries don't synchronise. Every retry-safe operation uses Idempotency keys stored in a dedicated database table — the first request succeeds, duplicates return the cached result. For message processing, the Claim-Check pattern uses `SELECT FOR UPDATE SKIP LOCKED` so multiple consumers can safely claim unique messages. And Backpressure ensures producers don't overload consumers — bounded queues and stream `drain` events regulate the flow."

---

## Phase 7: Operational Excellence

Run the system in production.

| Step | Doc | Key Talking Points | Practical Project Connection |
|------|-----|-------------------|------------------------------|
| 29 | [Service Discovery](service-discovery.md) | Client-side (Consul) vs server-side (Kubernetes DNS + kube-proxy). Health checks determine discoverability | Kubernetes DNS resolves service names to healthy pod IPs; readiness probes control traffic routing |
| 30 | [Leader Election](leader-election.md) | Lease-based (Redis SET NX + TTL) vs consensus-based (Raft). Split-brain risk with leases | Singleton batch job coordinator — report generation, cache warming |
| 31 | [Distributed Tracing](distributed-tracing.md) | OpenTelemetry, trace ID propagation, spans, parent-child relationships | Every request traced across all services, correlated by trace ID |

### Interview Checkpoint — Phase 7

> "In Kubernetes, service discovery is built-in — DNS resolves payment-service to healthy pod IPs via readiness probes. For singleton jobs, I use leader election with Redis — each instance tries to acquire a lock, and the winner is the leader. If the leader crashes, the lease expires and another instance takes over. For observability, every service propagates OpenTelemetry trace IDs in HTTP headers — a single checkout request generates spans across Order, Payment, and Inventory services."

---

## Phase 8: Capstone — Compose Everything

> This phase ties every concept together using the [Practical Project](practical-project.md) reference architecture. At this point you should be able to describe the entire flow end-to-end without looking at the docs.

### System Walkthrough

```text
                           Client
                              │
                              ▼
                        API Gateway
                     (Express / Fastify)
                     Rate limiting (Token bucket)
                     Circuit breaker (per downstream)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   Order Service        Payment Service      Inventory Service
   (Express +           (Express +            (Express +
    Prisma)              Prisma)               Prisma)
    Outbox Pattern       Idempotency           Pessimistic locking
    Saga participant     Event Sourcing        Claim-Check Pattern
                          Retry + backoff       SELECT FOR UPDATE
          │                   │                   │
          │              ┌────┴────┐              │
          │              ▼         ▼              │
          │         Stripe    Ledger              │
          │           │         │                 │
          └───────────┼─────────┼─────────────────┘
                      ▼         ▼
              Message Queue (Bull / Redis)
              Delivery semantics (at-least-once)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
  Notification Service      Analytics Service
  (Bull consumer)            (CQRS reads)
  Bulkhead (per queue)       Denormalised read models
  Backpressure (concurrency)  Built from event stream
```

### Place Order Flow — The Full Story

| Step | Action | Concepts Used |
|------|--------|---------------|
| 1 | Client sends `POST /orders` to API Gateway | **Rate Limiting** checks token bucket; passes through |
| 2 | Gateway forwards to Order Service via **Service Discovery** | Kubernetes DNS resolves `order-service` to a healthy pod |
| 3 | Order Service begins Prisma `$transaction` | **Database Concurrency Control** — ACID transaction |
| 4 | Within the transaction: create order + write event to outbox table | **Outbox Pattern** — solves dual-write problem |
| 5 | Inventory Service consumes `OrderCreated` via BullMQ (at-least-once) | **Delivery Semantics** — at-least-once delivery |
| 6 | Inventory Service uses `SELECT FOR UPDATE SKIP LOCKED` to claim and reserve items | **Claim-Check Pattern** + **Pessimistic Locking** |
| 7 | Inventory publishes `InventoryReserved` via its own outbox | **Outbox Pattern** again |
| 8 | Payment Service consumes `InventoryReserved` | **Event-Driven Architecture** |
| 9 | Payment Service checks idempotency key in the database | **Idempotency** — deduplicates retries |
| 10 | Payment Service calls Stripe; on failure, retries with exponential backoff + jitter | **Retry Pattern** — BullMQ built-in backoff |
| 11 | Stripe call is wrapped in a Circuit Breaker — if Stripe is down, fail fast | **Circuit Breaker** |
| 12 | Payment Service appends a charge event to the ledger | **Event Sourcing** |
| 13 | Order Service consumes `PaymentConfirmed` and updates order status | **Saga Pattern** — choreography step |
| 14 | Notification Service sends email (via separate queue with its own concurrency limit) | **Bulkhead** — email backlog does not block payments |
| 15 | Notification worker limits concurrent sends via `concurrency` setting | **Backpressure** |
| 16 | Analytics Service updates denormalised read models from the event stream | **CQRS** |
| 17 | OpenTelemetry traces the entire flow across 4 services | **Distributed Tracing** |
| 18 | If any step fails, compensating actions unwind (refund, release inventory) | **Saga Pattern** — compensation |
| 19 | On deploy, old pods receive SIGTERM and gracefully shut down | **Graceful Shutdown** — drain queues, close connections, exit |
| 20 | New pods register with Kubernetes DNS and start receiving traffic | **Leader Election** + **Service Discovery** |

---

## Summary: Weakness → Doc Mapping

| Interview Weakness | Phase | Doc to Study |
|--------------------|-------|--------------|
| Conflated concurrency with single-threaded | 1 | [Concurrency vs Parallelism](concurrency-vs-parallelism.md) |
| Could not articulate threads vs processes | 1 | [Concurrency vs Parallelism](concurrency-vs-parallelism.md) |
| Called event loop "synchronous" | 1 | [Event Loop](event-loop.md) |
| Vague on error handling patterns | 1 | [Error Handling (Express)](error-handling.md) |
| Vague on cancellation | 3 | [Cancellation & Timeouts](cancellation-timeouts.md) |
| Could not describe graceful shutdown steps | 3 | [Graceful Shutdown](graceful-shutdown.md) |
| Outbox pattern surface-level | 5 | [Outbox Pattern](outbox-pattern.md) |
| Idempotency for external side effects | 6 | [Idempotency](idempotency.md) |
| Optimistic concurrency/versioning not mentioned | 4 | [Database Concurrency Control](database-concurrency-control.md) |
| SQS alone — no dedupe store described | 6 | [Idempotency](idempotency.md) |

---

## Key Takeaways

> Study in phase order — runtime first, then theory, then async patterns, then data, then events, then resilience, then operations, then compose everything. For each doc, memorise the Key Takeaways as your elevator pitch, trace the Architecture diagram aloud, and rewrite the Node.js code from memory. The Practical Project ties every concept into a single end-to-end flow — be able to walk through the Place Order flow in under 5 minutes, naming every pattern and why it is used.
