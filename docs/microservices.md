# Microservices

> An architectural style that structures an application as a collection of independently deployable, loosely coupled services, each owning its own data and domain.

---

## What is it?

Microservices decompose an application into **domain-boundary services**, each with its own database, its own deployment pipeline, and its own communication contract. Services interact over a network via synchronous calls (HTTP, gRPC) or asynchronous messages (events, queues).

This contrasts with a **monolith**, where all functionality is built as a single deployable unit sharing a single database.

| Aspect | Monolith | Microservices |
|--------|----------|---------------|
| **Deployment** | One unit — full application deployed together | Independent deployment per service |
| **Database** | Single shared database | Database per service (private data) |
| **Scaling** | Scale the entire application | Scale only the services that need it |
| **Team autonomy** | Coordinated releases across teams | Teams own services end-to-end |
| **Communication** | In-process function calls | Remote calls (HTTP, gRPC) or events |
| **Testing** | Single integration surface | Service-level + contract + integration tests |
| **Observability** | Single log stream, single metric source | Distributed tracing, aggregated logs |

---

## Why Microservices?

Microservices are primarily an **organizational scaling pattern**, described by Conway's Law: organisations design systems that mirror their communication structure. A team that owns a service can deploy it independently of other teams.

**Technical benefits** (secondary):
- Independent scaling — only the bottleneck service scales
- Technology isolation — each service can use the best tool for its job
- Failure isolation — a crash in one service does not bring down others
- Faster deployments — smaller codebase, faster build, focused tests

---

## Communication Patterns

### Synchronous (Request-Reply)

The calling service sends a request and waits for a response. Tight coupling in time — both services must be available.

| Protocol | Use Case |
|----------|----------|
| **HTTP / REST** | Simple request-reply, CRUD operations, client-facing APIs |
| **gRPC** | Typed, streaming, low-latency inter-service communication |

**Risk**: cascading failures if the downstream is unavailable. Mitigated by [Circuit Breaker](circuit-breaker.md), [Retry Pattern](retry-pattern.md), and [Bulkhead Pattern](bulkhead-pattern.md).

### Asynchronous (Events / Queues)

The producer publishes a message and does not wait. The consumer processes when ready. Loose coupling — services are only coupled by event schema, not availability.

| Mechanism | Use Case |
|-----------|----------|
| **Message Queue** | Work distribution, load levelling, reliable delivery |
| **Event Stream** | Event broadcast, replay, audit log |
| **Webhook** | Server-to-server callback without polling |

**Risk**: eventual consistency, duplicate delivery, out-of-order processing. Mitigated by [Idempotency](idempotency.md), [Outbox Pattern](outbox-pattern.md), and [Event Versioning](event-versioning.md).

For a deeper comparison, see [Event-Driven Architecture](event-driven-architecture.md) and [Polling Strategies](polling-strategies.md).

---

## Architecture

```text
                              API Gateway
                           Rate limiting, auth,
                         routing, API versioning
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        Order Service       Payment Service      Inventory Service
        (PostgreSQL)        (PostgreSQL)          (PostgreSQL)
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                          Message Queue (BullMQ / SQS)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
    Notification Service   Analytics Service     Invoice Service
        (PostgreSQL)         (DynamoDB)             (PostgreSQL)
```

---

## Key Challenges

Every challenge in a microservices architecture maps to a pattern documented in this library:

| Challenge | Pattern | Doc |
|-----------|---------|-----|
| Data consistency across services | Saga, Outbox, Distributed Transactions | [Saga Pattern](saga-pattern.md), [Outbox Pattern](outbox-pattern.md), [Distributed Transactions](distributed-transactions.md) |
| Service discovery | DNS, service registry, health checks | [Service Discovery](service-discovery.md) |
| API evolution without breaking clients | Versioning routers, deprecation headers | [API Versioning](api-versioning.md) |
| Event schema evolution | Event versioning, upcast functions | [Event Versioning](event-versioning.md) |
| Resilient inter-service calls | Circuit Breaker, Retry, Bulkhead | [Circuit Breaker](circuit-breaker.md), [Retry Pattern](retry-pattern.md), [Bulkhead Pattern](bulkhead-pattern.md) |
| Preventing duplicate side effects | Idempotency keys, dedup table | [Idempotency](idempotency.md) |
| Flow control | Backpressure, Rate Limiting | [Backpressure](backpressure.md), [Rate Limiting](rate-limiting.md) |
| Observability | Distributed tracing, structured logging | [Distributed Tracing](distributed-tracing.md) |
| Database changes without downtime | Expand-migrate-contract, backward-compatible migrations | [Database Migrations](database-migrations.md) |
| Concurrency safety | Optimistic / pessimistic locking | [Database Concurrency Control](database-concurrency-control.md) |
| Graceful pod termination | Signal handling, drain queues | [Graceful Shutdown](graceful-shutdown.md) |
| Safe deployments | Feature flags, canary, rollout strategies | [Rollout Strategies](rollout-strategies.md) |
| Coordinating one leader | Lease-based or consensus-based election | [Leader Election](leader-election.md) |
| Testing async flows | Unit, integration, contract tests | [Testing Event-Driven Systems](testing-event-driven-systems.md) |

---

## When to Use

- **Multiple autonomous teams** — each team can own and deploy its services independently
- **Domain complexity** — the business domain has clear bounded contexts (DDD) that map naturally to service boundaries
- **Scalability requirements** — different parts of the system have different scaling needs (e.g., order ingestion needs 10x the capacity of report generation)
- **Technology diversity** — different services benefit from different data stores or runtimes
- **Independent release cycles** — teams need to deploy at different cadences without coordination

---

## When NOT to Use

- **Small team** — the operational overhead of running multiple services outweighs the benefits for a team of 3-5 developers
- **Simple domain** — CRUD operations over a single database are better served by a well-structured monolith
- **Early-stage product** — speed of iteration matters more than service boundaries; extract services when the monolith hurts
- **No clear domain boundaries** — splitting along uncertain lines creates distributed monolith (services that are tightly coupled by frequent synchronous calls)
- **Low operational maturity** — microservices require CI/CD, container orchestration, observability, and on-call practices that a monolith does not

---

## Related Concepts

- [Distributed Systems](distributed-systems.md) — microservices are a type of distributed system
- [Event-Driven Architecture](event-driven-architecture.md) — the primary communication paradigm for loosely coupled services
- [CQRS](cqrs.md) — separating read and write responsibilities across services
- [CAP Theorem](cap-theorem.md) — the trade-off that governs data consistency in distributed services
- [Practical Project](practical-project.md) — reference e-commerce architecture implementing all microservices patterns

---

## Key Takeaways

> Microservices decompose an application by domain boundary, not technical layer. Each service owns its database, deploys independently, and communicates over a network. The primary benefit is organizational — autonomous teams with independent release cycles. The cost is operational complexity: distributed data consistency, service discovery, observability, and testing. Do not start with microservices — start with a well-structured monolith and extract services as domain boundaries and team structure demand it. Every microservices challenge has a documented pattern; this library covers them all.
