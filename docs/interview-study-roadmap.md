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
| 17 | [Distributed Cache](distributed-cache.md) | Partitioning, replication, failover, hot keys, cache stampede on node loss, AP consistency trade-offs | Redis Cluster partitions the product catalog cache across nodes and replicates it for availability |
| 18 | [Database Migrations](database-migrations.md) | Expand-migrate-contract for zero-downtime schema changes; backward-compatible migrations; rollback strategies | Every service applies expand-migrate-contract for schema changes — adding a NOT NULL column backfills before adding the constraint |

### Interview Checkpoint — Phase 4

> "For data correctness, I use Prisma `$transaction` for atomic multi-step writes. For high-contention resources like flash sale inventory, I use `SELECT FOR UPDATE` to pessimistically lock the row. For lower contention, optimistic locking with a version column avoids lock overhead. I avoid distributed transactions (2PC) — instead, I use the Saga pattern with compensating actions for multi-service workflows. For scaling, I shard by customer_id and replicate for read throughput. Consistent hashing is what Redis Cluster uses to distribute cache keys with minimal reshuffling when nodes change. For schema changes in production, I follow expand-migrate-contract — add the new column as nullable, backfill existing rows, then add the NOT NULL constraint. This avoids downtime during rolling deploys."

---

## Phase 5: Event-Driven Architecture

The heart of the system — how services communicate asynchronously.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 19 | [Event-Driven Architecture](event-driven-architecture.md) | Basic familiarity but lacked depth | Event production, event channels (message broker), event consumption. Loose coupling, scalability, eventual consistency | All services communicate through Bull/Redis message queue. Order Service publishes events; Notification and Analytics services consume them |
| 20 | [Outbox Pattern](outbox-pattern.md) | Knew the name but surface-level | Dual-write problem (write DB + publish event in one transaction), outbox table, poller/publisher, at-least-once delivery | Order Service publishes `OrderCreated`/`PaymentConfirmed` without dual-write risk — writes event to outbox table in same Prisma `$transaction`, then a poller publishes to BullMQ |
| 21 | [Event Sourcing](event-sourcing.md) | Not mentioned | Append-only event store as source of truth, replayable projections, audit trail, event versioning | Payment Service stores ledger as an append-only event stream — every charge, refund, and reversal is an event |
| 22 | [CQRS](cqrs.md) | Not mentioned | Separate read and write models. Commands go to the write model (optimised for writes), queries go to the read model (denormalised for fast reads) | Analytics Service maintains denormalised read models built from the event stream — one query, no joins |
| 23 | [Event Versioning](event-versioning.md) | Could not articulate backward/forward compatibility for schema evolution | Backward compatible (new reads old), forward compatible (old reads new), upcast function, schema registry, new event type vs new version | All services version event schemas for backward compatibility; upcast functions transform old events to latest schema before processing |

### Interview Checkpoint — Phase 5

> "Services communicate asynchronously through event-driven architecture. The critical challenge is the dual-write problem — I solve it with the Outbox Pattern: within a single Prisma transaction, I write the business data and the event to an outbox table. A separate poller reads the outbox and publishes to BullMQ. This gives at-least-once delivery without distributed transactions. For the payment ledger, I use Event Sourcing — every financial operation is an append-only event, which gives a complete audit trail and the ability to replay state. For read performance, I use CQRS: the Analytics Service maintains denormalised read models that are built from the event stream and optimised for specific queries. Event schemas evolve over time — I use versioning with upcast functions so new consumers can process old events and old consumers ignore new fields."

---

## Phase 6: Resilience Patterns

How the system survives failures without cascading.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 24 | [Idempotency](idempotency.md) | Described SQS alone, not the idempotency store | Idempotency key (client UUID), idempotency table (key + result), deduplication flow, email send-log pattern | Payment Service deduplicates charge requests on retry — checks idempotency key before calling Stripe |
| 25 | [Retry Pattern](retry-pattern.md) | Not mentioned | Exponential backoff (delay = base * 2^n), jitter (full/equal/decorrelated), max retries, dead letter queue | BullMQ workers use exponential backoff + jitter for payment and notification jobs |
| 26 | [Circuit Breaker](circuit-breaker.md) | Not mentioned | States: closed (normal) → open (failing fast) → half-open (probbing). Error threshold, timeout window, fallback | Order Service wraps downstream Payment API calls with opossum — when Payment is degraded, it fails fast |
| 27 | [Rate Limiting](rate-limiting.md) | Not mentioned | Token bucket, sliding window, fixed window. 429 + Retry-After header | API Gateway enforces per-client rate limits with token bucket |
| 28 | [Bulkhead Pattern](bulkhead-pattern.md) | Not mentioned | Isolate connection pools per dependency. One slow service cannot exhaust shared resources | Each service has dedicated connection pools per downstream dependency |
| 29 | [Backpressure](backpressure.md) | Not mentioned | Producer must not outpace consumer. Bounded queues, stream `drain` events, user credits | Queue workers limit concurrency; streams use backpressure-aware piping |
| 30 | [Distributed Lock](distributed-lock.md) | Not mentioned | Mutual exclusion via Redis SET NX with TTL. try/finally release, lease renewal | Coordination across service instances for singleton jobs |
| 31 | [Claim-Check Pattern](claim-check-pattern.md) | Not mentioned | `SELECT ... FOR UPDATE SKIP LOCKED` for exactly-once consumer processing | Inventory Service uses `SELECT FOR UPDATE SKIP LOCKED` on reservation rows to prevent concurrent overselling |

### Interview Checkpoint — Phase 6

> "Resilience is layered. At the entry point, the API Gateway rate-limits clients with a token bucket — returning 429 when exceeded. Internally, each service has a Bulkhead — separate connection pools per dependency so a slow payment API cannot exhaust database connections. Calls to downstream services are wrapped in a Circuit Breaker that opens after 50% errors and probes for recovery in the half-open state. For retries, I use exponential backoff with full jitter so retries don't synchronise. Every retry-safe operation uses Idempotency keys stored in a dedicated database table — the first request succeeds, duplicates return the cached result. For message processing, the Claim-Check pattern uses `SELECT FOR UPDATE SKIP LOCKED` so multiple consumers can safely claim unique messages. And Backpressure ensures producers don't overload consumers — bounded queues and stream `drain` events regulate the flow."

---

## Phase 7: Operational Excellence

Run the system in production.

| Step | Doc | Key Talking Points | Practical Project Connection |
|------|-----|-------------------|------------------------------|
| 32 | [Service Discovery](service-discovery.md) | Client-side (Consul) vs server-side (Kubernetes DNS + kube-proxy). Health checks determine discoverability | Kubernetes DNS resolves service names to healthy pod IPs; readiness probes control traffic routing |
| 33 | [Leader Election](leader-election.md) | Lease-based (Redis SET NX + TTL) vs consensus-based (Raft). Split-brain risk with leases | Singleton batch job coordinator — report generation, cache warming |
| 34 | [Distributed Tracing](distributed-tracing.md) | OpenTelemetry, trace ID propagation, spans, parent-child relationships | Every request traced across all services, correlated by trace ID |
| 35 | [API Versioning](api-versioning.md) | Vague on API versioning mechanics | URL prefix vs header vs query parameter; separate Express routers per version; shared services between versions; deprecation headers and sunset timeline | API Gateway mounts `/api/v1` and `/api/v2` routers; deprecated versions get `Sunset` headers with a clear migration deadline |
| 36 | [API Authentication](api-authentication.md) | Could not explain token lifecycle or OAuth flows | API keys, sessions vs stateless JWT (revocation), access/refresh tokens, OAuth 2.0 authorization code + PKCE, OIDC, SSO; 401 vs 403 | API Gateway validates bearer tokens and enforces role-based authorization on all `/api` routes |
| 37 | [OAuth 2.0](oauth2.md) | Could not distinguish grant types | Authorization Code + PKCE (SPAs/mobile), Client Credentials (server-to-server), scopes, access vs refresh tokens, JWKS validation | API Gateway validates OAuth access tokens against the IdP's JWKS; scopes gate `/api` routes |
| 38 | [OpenID Connect (OIDC)](oidc.md) | Could not explain ID token vs access token | ID token (identity, signed JWT), UserInfo endpoint, discovery, `nonce`, single sign-on | Keycloak issues OIDC ID tokens; the gateway verifies identity before authorization |
| 39 | [API Security (OWASP Top 10)](owasp-top-10.md) | Could not name common API vulnerabilities | Injection (parameterised queries), broken authN/authZ (IDOR), SSRF, misconfiguration, defence in depth | API Gateway authenticates and authorises every route; all queries parameterised via Prisma; ownership checks prevent IDOR |
| 40 | [TLS & mTLS](tls-mtls.md) | Could not explain transport security | TLS handshake, certificates, HTTPS, mTLS for service-to-service, zero-trust | All external traffic over HTTPS; internal services use mTLS via service mesh |
| 41 | [Webhook Security](webhook-security.md) | Could not explain webhook verification | HMAC-SHA256 signature, raw body, timingSafeEqual, replay protection, idempotent handlers | Payment Service verifies Stripe webhook signatures before processing events |
| 42 | [Secrets Management](secrets-management.md) | Could not describe secret handling | No secrets in code/git, secret manager, least privilege, rotation, auditing | All credentials stored in AWS Secrets Manager; injected via env at deploy; rotated on schedule |
| 43 | [Rollout Strategies](rollout-strategies.md) | Lacked concrete rollout mechanics | Feature flags, percentage rollout with deterministic bucketing, canary releases, allowlists, A/B testing; flag lifecycle from config to removal | Feature flags control gradual rollout of the new checkout flow; percentage routing for canary deployments |

### Interview Checkpoint — Phase 7

> "In Kubernetes, service discovery is built-in — DNS resolves payment-service to healthy pod IPs via readiness probes. For singleton jobs, I use leader election with Redis — each instance tries to acquire a lock, and the winner is the leader. If the leader crashes, the lease expires and another instance takes over. For observability, every service propagates OpenTelemetry trace IDs in HTTP headers — a single checkout request generates spans across Order, Payment, and Inventory services. For API versioning, I mount separate Express routers per version under `/api/v1` and `/api/v2`, sharing common services between them. Deprecated versions return `Sunset` headers. For rollouts, I use feature flags with deterministic user bucketing — start with an allowlist, ramp to 10%, then 50%, then 100%. If metrics degrade, I disable the flag instantly without redeploying."

---

## Phase 8: Testing & Quality

> How to test event-driven, asynchronous systems at every layer — from unit tests to integration tests with real infrastructure.

| Step | Doc | Interview Weakness Addressed | Key Talking Points | Practical Project Connection |
|------|-----|------------------------------|-------------------|------------------------------|
| 44 | [Testing Event-Driven Systems](testing-event-driven-systems.md) | Could not describe how to test async handlers, idempotency, or projections | Three test layers: unit (mocked event store/bus), integration (real DB + in-memory broker), contract (event shape). In-memory event store for fast handler tests. Testcontainers for real PostgreSQL. Idempotency test — same event twice, side effects once | All handlers are unit-tested with mocked event stores; projections are integration-tested against a testcontainers PostgreSQL; outbox tests verify both business data and event are written atomically |

### Interview Checkpoint — Phase 8

> "I test event-driven code in layers. Unit tests mock the event store and bus to test handler logic in milliseconds. Integration tests use testcontainers to spin up real PostgreSQL — projections write to a real database so I can assert the read model is correct. Idempotency tests process the same event twice and verify side effects happen only once. For the outbox pattern, I test that both the business data and the outbox event are written atomically within the same transaction."

---

## Phase 9: Capstone — Compose Everything

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
                      API versioning (/api/v1, /api/v2)
                      Feature flags / rollout strategies
                               │
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    Order Service        Payment Service      Inventory Service
    (Express +           (Express +            (Express +
     Prisma)              Prisma)               Prisma)
     Outbox Pattern       Idempotency           Pessimistic locking
     Saga participant     Event Sourcing        Claim-Check Pattern
     Event versioning     Retry + backoff       SELECT FOR UPDATE
     DB migrations                               DB migrations
           │                   │                   │
           │              ┌────┴────┐              │
           │              ▼         ▼              │
           │         Stripe    Ledger              │
           │           │         │                 │
           └───────────┼─────────┼─────────────────┘
                       ▼         ▼
               Message Queue (Bull / Redis)
               Delivery semantics (at-least-once)
               Event versioning (upcast on consume)
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
   Notification Service      Analytics Service
   (Bull consumer)            (CQRS reads)
   Bulkhead (per queue)       Denormalised read models
   Backpressure (concurrency)  Built from event stream
   Integration tests           Contract tests
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
| 19 | Events are versioned; old consumers process v1 events with upcast functions | **Event Versioning** — backward compatibility |
| 20 | On deploy, new code is rolled out via feature flags — 10% → 50% → 100% | **Rollout Strategies** — percentage routing, deterministic bucketing |
| 21 | API version `/api/v1` is deprecated with `Sunset` headers; clients migrate to `/api/v2` | **API Versioning** — deprecation timeline |
| 22 | A NOT NULL column is added via expand-migrate-contract across two deploys | **Database Migrations** — zero-downtime schema changes |
| 23 | On deploy, old pods receive SIGTERM and gracefully shut down | **Graceful Shutdown** — drain queues, close connections, exit |
| 24 | New pods register with Kubernetes DNS and start receiving traffic | **Leader Election** + **Service Discovery** |
| 25 | Every handler is unit-tested; projections are integration-tested; event schemas are contract-tested | **Testing Event-Driven Systems** — test pyramid for async code |

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
| Could not articulate backward/forward compatibility for schema evolution | 5 | [Event Versioning](event-versioning.md) |
| Vague on API versioning mechanics | 7 | [API Versioning](api-versioning.md) |
| Lacked concrete rollout mechanics | 7 | [Rollout Strategies](rollout-strategies.md) |
| No database migration strategy | 4 | [Database Migrations](database-migrations.md) |
| Could not describe testing approach for event-driven code | 8 | [Testing Event-Driven Systems](testing-event-driven-systems.md) |

---

## Mock Interview Questions Reference

Nine questions from a mock AI interview, mapped to the docs that address each gap.

| # | Question | Key Concepts | Docs to Study |
|---|----------|--------------|---------------|
| 1 | How do you handle backpressure when streaming data (e.g., reading from a DB/file and writing to an HTTP response) in Node.js? | Stream `drain` events, `highWaterMark`, `pipeline` vs pipe, readableFlowing, backpressure-aware piping | [Backpressure](backpressure.md) |
| 2 | In an event-driven architecture, how do you decide between emitting an event vs sending a command, and what guarantees would you expect from each? | Event = past fact, fan-out, loose coupling. Command = intent, directed, stronger handling expectations. CQRS separates command and query responsibilities | [Event-Driven Architecture](event-driven-architecture.md), [CQRS](cqrs.md) |
| 3 | How would you implement idempotency for event consumers so retries or duplicate deliveries don't cause double side effects? | Idempotency key table (key + result + processed_at), dedup before processing, at-least-once + idempotent consumer = exactly-once semantics | [Idempotency](idempotency.md), [Delivery Semantics](delivery-semantics.md) |
| 4 | When designing schema evolution for events, how do you change an event payload without breaking existing consumers? | New event type vs new version field, upcast functions transform old schemas to latest, schema registry for validation | [Event Versioning](event-versioning.md) |
| 5 | How do you ensure backward and forward compatibility when adding, removing, or renaming fields in an event schema? | Backward compatible (new reader processes old events via upcast). Forward compatible (old reader ignores unknown fields — tolerant reader). Schema-on-read decouples production from consumption | [Event Versioning](event-versioning.md) |
| 6 | In Node.js/Express, if you support `/v1` and `/v2` concurrently, how do you structure routing and shared business logic to avoid duplication while keeping behavior isolated per version? | Separate Express routers per version mounted at different paths. Shared services layer for cross-cutting concerns (auth, logging). Version-specific controllers for divergent behavior | [API Versioning](api-versioning.md) |
| 7 | How do you decide what belongs in shared logic versus version-specific logic when behavior differs subtly (e.g., validation rules or response fields)? | Drive from business requirements — shared services for unchanged business rules, strategy/per-version function for differences. Composition over duplication | [API Versioning](api-versioning.md) |
| 8 | What's your strategy for introducing a breaking change safely — deprecation timeline, monitoring, and communication? | Sunset header, deprecation notice in response, monitoring consumer usage analytics, clear migration deadline communicated in advance, maintain old version until traffic drops to zero | [API Versioning](api-versioning.md), [Rollout Strategies](rollout-strategies.md) |
| 9 | How would you implement a gradual rollout (canary) at runtime — what signals or routing rules decide which requests go to v1 vs v2? | Feature flags with deterministic user bucketing (hash(user_id) % 100), percentage ramp (allowlist → 10% → 50% → 100%), metrics-gated progression, instant flag toggle for rollback | [Rollout Strategies](rollout-strategies.md) |

### Set 2 — Runtime, Async, & Concurrency

Another 17 questions from an earlier round. Entries marked "(see Set 1 Qx)" duplicate the topic above — focus your polish on the new entries.

| # | Question | Key Concepts | Docs to Study |
|---|----------|--------------|---------------|
| 1 | What's the difference between concurrency and parallelism in async programming, and why does it matter? | Concurrency = managing many tasks (interleaving). Parallelism = executing many tasks at once (simultaneous). Event loop model vs multi-threaded | [Concurrency vs Parallelism](concurrency-vs-parallelism.md) |
| 2 | What can go wrong if you assume concurrency gives you thread-safety? | Shared state + async interleaving = logic-level race conditions even on a single thread. Async/await does not guarantee atomicity | [Node.js Race Conditions](nodejs-race-conditions.md), [Database Concurrency Control](database-concurrency-control.md) |
| 3 | How do you prevent one long-running CPU-bound task from blocking other async tasks? | Event loop phases — CPU blocks all 6 phases. Offload CPU work to `worker_threads` so the event loop stays responsive for I/O | [Event Loop](event-loop.md), [Concurrency vs Parallelism](concurrency-vs-parallelism.md) |
| 4 | How do you decide between thread pool vs separate process pool for offloaded CPU work? | `worker_threads` (shared memory, lighter, same process) for CPU tasks like image resizing. `child_process` (separate memory, stronger isolation) for running non-Node.js binaries like ffmpeg | [Concurrency vs Parallelism](concurrency-vs-parallelism.md) |
| 5 | How do you handle cancellation and timeouts for async tasks so orphaned work is cleaned up? | `AbortController`, `AbortSignal`, timeout wrappers, cleanup handlers on abort, `Promise.race` with rejection on timeout | [Cancellation & Timeouts](cancellation-timeouts.md), [Promise APIs](promise-apis.md) |
| 6 | When multiple async tasks share state, how do you avoid race conditions while keeping throughput high? | Single authoritative state owner, atomic DB operations (Prisma `update` with version check), avoid shared mutable state across async boundaries | [Node.js Race Conditions](nodejs-race-conditions.md), [Database Concurrency Control](database-concurrency-control.md) |
| 7 | How do you prevent race conditions when multiple consumers update the same aggregate based on events? | Optimistic concurrency — version field on aggregate, `UPDATE ... WHERE version = :expected`, `UNIQUE(aggregate_id, version)` in event store. Event sourcing eliminates conflicting writes (append-only) | [Database Concurrency Control](database-concurrency-control.md), [Event Sourcing](event-sourcing.md) |
| 8 | How would you design idempotency end-to-end so a consumer can safely process the same message multiple times? | (see Set 1 Q3) | Same as Set 1 Q3 |
| 9 | How do you handle idempotency for non-database side effects (payment API, email) when the same event is redelivered? | Idempotency key in external API request header. Send-log table (recipient + subject + idem_key UNIQUE). Check-before-act: query send-log, skip if record exists | [Idempotency](idempotency.md) |
| 10 | How would you implement exactly-once email send with idempotency key and a persistent send-log? | Send-log table: `(idempotency_key, recipient, subject, sent_at)` with UNIQUE on key. On receive: check send-log → if found, skip; if not, send → insert send-log atomically | [Idempotency](idempotency.md) |
| 11 | Event ID flow — what's the exact server-side flow? | (see Set 1 Q3) | Same as Set 1 Q3 |
| 12 | What's the difference between the event loop and the call stack, and how does it affect handling many concurrent requests? | Call stack runs synchronous JS (LIFO). Event loop coordinates async callbacks across 6 phases. Non-blocking I/O lets the call stack unwind while the event loop picks up results later — this is how Node handles high concurrency on one thread | [Event Loop](event-loop.md) |
| 13 | When would you choose `worker_threads` over non-blocking async I/O? | (see Set 2 Q3, Q4) | Same as Set 2 Q3/Q4 |
| 14 | How would you implement graceful shutdown — stop accepting new requests, finish in-flight, close resources? | (see Set 1 Q6) | Same as Set 1 Q6 |
| 15 | How do you track in-flight requests so shutdown waits for them (with a timeout)? | (see Set 1 Q7) | Same as Set 1 Q7 |
| 16 | What specific steps to stop new connections, deal with keep-alive sockets, wait for in-flight requests? | (see Set 1 Q7) | Same as Set 1 Q7 |
| 17 | How do you centralize error handling for async route handlers in Express so thrown/rejected errors reliably reach one error middleware? | `asyncHandler` wrapper catches rejected promises, `next(error)` forwards to centralized error middleware. Custom error classes with status codes. Never `try/catch` in every handler | [Error Handling (Express)](error-handling.md) |

### Set 3 — Idempotency Deep-Dive, Outbox, Shutdown, Event Loop

Mostly overlaps with Set 1 and Set 2. Two new angles: lock expiry + durable idempotency, and row-level claim-check for concurrent consumers.

| # | Question | Key Concepts | Docs to Study |
|---|----------|--------------|---------------|
| 1 | How do you design consumers to be idempotent — what identifiers/state do you persist? | (see Set 1 Q3) | Same as Set 1 Q3 |
| 2 | Lock expires mid-processing, second consumer starts — how do you still not double-charge? | Distributed lock + durable idempotency record as secondary safeguard. Lock lease renewal, `try/finally` release, but always check idempotency store before acting | [Distributed Lock](distributed-lock.md), [Idempotency](idempotency.md) |
| 3 | How do you ensure you don't ack the input message unless the outgoing event is durably published? | (see Set 1 Q3, Q4 — outbox pattern) | Same as Set 1 Q3/Q4 |
| 4 | How would you implement this with an Outbox pattern — tables/fields, exact sequence? | (see Set 1 Q4) | Same as Set 1 Q4 |
| 5 | Two Node.js consumers updating the same message row concurrently — processed exactly once? | `SELECT ... FOR UPDATE SKIP LOCKED` to claim unique messages. Only the claiming consumer processes and acks. Others skip to the next unclaimed row | [Claim-Check Pattern](claim-check-pattern.md), [Database Concurrency Control](database-concurrency-control.md) |
| 6 | How would you implement graceful shutdown in a Node.js message consumer so in-flight jobs finish (or are safely re-queued) before exit? | (see Set 1 Q6, Q7) | Same as Set 1 Q6/Q7 |
| 7 | Which process signals/events, what steps (stop pulling, drain tasks, close connections)? | (see Set 1 Q7) | Same as Set 1 Q7 |
| 8 | How do you prevent the event loop from being blocked by CPU-heavy work in an HTTP/API service? | (see Set 2 Q3) | Same as Set 2 Q3 |

### Set 4 — Migration Locking & Schema Version Concurrency

Two questions on coordinating schema changes and concurrent record migration across multiple Node.js instances.

| # | Question | Key Concepts | Docs to Study |
|---|----------|--------------|---------------|
| 1 | In Node.js, what locking strategy would you use to ensure only one instance migrates a given document at a time (e.g., DB-level conditional update, Redis lock, advisory lock), and why? | Advisory lock (`pg_advisory_lock`) ties to the DB transaction (auto-released on disconnect). Redis lock (`SET NX + TTL`) works across tech stacks but needs manual cleanup. DB conditional update (`UPDATE ... WHERE migrated = false`) is simplest when all instances share the same DB. Trade-offs: advisory lock is safest for DB-bound work; Redis lock is better when multiple services coordinate | [Database Migrations](database-migrations.md), [Distributed Lock](distributed-lock.md), [Database Concurrency Control](database-concurrency-control.md) |
| 2 | You have 3 Node.js servers. Two read the same record with schemaVersion: 1 at nearly the same time, and both try to migrate it to version 2 and write it back. How would you prevent lost updates — what specific locking or "only update if version is still 1" mechanism would you use, and where would it live (database vs Redis vs in-process)? | Optimistic locking: `UPDATE ... WHERE schemaVersion = 1` — only the first write succeeds; the second gets 0 rows affected and retries. Lives in the database (the single source of truth). PostgreSQL advisory lock for claiming the migration task. In-process is useless (3 separate processes). Redis lock adds latency vs DB-native check | [Database Concurrency Control](database-concurrency-control.md), [Distributed Lock](distributed-lock.md) |

### Focus Areas

The questions cluster around key docs — prioritise these for polish:

- **[Event Versioning](event-versioning.md)** — Set 1 Q4, Q5. Backward/forward compatibility, upcast functions, tolerant reader.
- **[API Versioning](api-versioning.md)** — Set 1 Q6, Q7, Q8. Express router isolation, shared vs version-specific logic, deprecation lifecycle.
- **[Rollout Strategies](rollout-strategies.md)** — Set 1 Q8, Q9. Feature flags, canary releases, deterministic bucketing, metrics-gated rollout.
- **[Idempotency](idempotency.md)** — Set 1 Q3, Set 2 Q9, Q10, Set 3 Q2. Dedup table flow, send-log pattern, exactly-once email, durable idempotency beyond locks.
- **[Concurrency vs Parallelism](concurrency-vs-parallelism.md)** — Set 2 Q1, Q2, Q3, Q4. Concurrency vs parallelism, thread vs process decision, blocking the event loop.
- **[Event Loop](event-loop.md)** — Set 2 Q3, Q12. Relationship with call stack, how CPU blocks all phases.
- **[Database Concurrency Control](database-concurrency-control.md)** — Set 2 Q2, Q6, Q7, Set 3 Q5. Optimistic locking, version fields, `SELECT FOR UPDATE SKIP LOCKED` for consumer claiming.
- **[Error Handling (Express)](error-handling.md)** — Set 2 Q17. asyncHandler, centralized error middleware.
- **[Cancellation & Timeouts](cancellation-timeouts.md)** — Set 2 Q5. AbortController, cleanup on abort.
- **[Claim-Check Pattern](claim-check-pattern.md)** — Set 3 Q5. Row-level locking for exactly-once consumer processing.
- **[Distributed Lock](distributed-lock.md)** — Set 3 Q2, Set 4 Q1, Q2. Lock as first line of defence, idempotency store as second. Migration locking strategies: advisory lock (`pg_advisory_lock`) vs Redis lock (`SET NX + TTL`) vs conditional update.
- **[Database Migrations](database-migrations.md)** — Set 4 Q1. Migration locking strategies, advisory lock vs Redis lock vs conditional update.
- **[Database Concurrency Control](database-concurrency-control.md)** — Set 4 Q2. Optimistic locking with version check (`UPDATE ... WHERE version = :expected`), lost-update prevention across instances.

Each of these docs has an **Interview Checkpoint** in its phase above and a **Key Takeaways** section — recite those aloud until fluent. Focus especially on the docs that appear across multiple question sets (Idempotency, Database Concurrency Control, Concurrency vs Parallelism).

---

## Key Takeaways

> Study in phase order — runtime first, then theory, then async patterns, then data, then events, then resilience, then operations, then testing, then compose everything. For each doc, memorise the Key Takeaways as your elevator pitch, trace the Architecture diagram aloud, and rewrite the Node.js code from memory. The Practical Project ties every concept into a single end-to-end flow — be able to walk through the Place Order flow in under 5 minutes, naming every pattern and why it is used. The interview questions test depth: never stop at the first answer — prepare for the "what if it fails?" follow-up on every pattern.
