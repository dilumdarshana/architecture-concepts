# 2-Day Interview Prep Plan

## Day 1 — Runtime + Data + Events

### Morning (3h) — Runtime Foundation
- [ ] **Event Loop** — trace the 6 phases aloud; explain why CPU blocks all phases; `setImmediate` vs `setTimeout` vs `nextTick`
- [ ] **Concurrency vs Parallelism** — recite the distinction; worker_threads vs child_process decision table
- [ ] **Error Handling (Express)** — write `asyncHandler` + central error middleware from memory
- [ ] **Promise APIs** — `all` vs `allSettled` vs `race` vs `any` with use cases

### Midday (2h) — Data Layer
- [ ] **Database Concurrency Control** — optimistic vs pessimistic locking; MVCC; `UNIQUE(aggregate_id, version)`
- [ ] **Database Migrations** — expand-migrate-contract for zero-downtime schema changes; adding NOT NULL columns safely

### Afternoon (3h) — Event-Driven Architecture
- [ ] **Event-Driven Architecture** — production, channels, consumption; loose coupling; eventual consistency
- [ ] **Outbox Pattern** — dual-write problem; Prisma `$transaction` + poller flow; write the code from memory
- [ ] **Event Sourcing** — append-only store; replay projections; audit trail; `PgEventStore` pattern
- [ ] **CQRS** — separate read/write models; why Analytics uses denormalised read models
- [ ] **Event Versioning** — backward vs forward compat; upcast functions; schema registry

### Evening (1h) — Review
- [ ] Recite Phase 4 and Phase 5 checkpoint answers aloud
- [ ] Rewrite outbox poller + event store code from memory

---

## Day 2 — Resilience + Operations + Testing + Capstone

### Morning (3h) — Resilience Patterns
- [ ] **Idempotency** — key table; dedupe flow; email send-log pattern; write the code
- [ ] **Retry Pattern** — exponential backoff + full jitter; max retries; DLQ
- [ ] **Circuit Breaker** — closed → open → half-open; opossum example
- [ ] **Rate Limiting** — token bucket vs sliding window; 429 + Retry-After
- [ ] **Bulkhead** — separate connection pools per dependency
- [ ] **Backpressure** — bounded queues; stream `drain`; consumer concurrency
- [ ] **Claim-Check Pattern** — `SELECT FOR UPDATE SKIP LOCKED`

### Midday (2h) — Operations
- [ ] **Graceful Shutdown** — SIGTERM → drain queues → close connections → exit; write the code
- [ ] **Service Discovery** — Kubernetes DNS + readiness probes
- [ ] **Distributed Tracing** — OpenTelemetry; trace ID propagation
- [ ] **API Versioning** — Express routers per version; `Sunset` headers; deprecation timeline
- [ ] **Rollout Strategies** — feature flags; deterministic user bucketing; canary; allowlist progression

### Afternoon (2h) — Testing
- [ ] **Testing Event-Driven Systems** — three layers: unit (mock store), integration (testcontainers), contract (event shape)
- [ ] Write an in-memory event store test from memory
- [ ] Write an idempotency test (same event twice, side effect once)

### Evening (2h) — Capstone Walkthrough
- [ ] Trace the **Place Order Flow** (25 steps) from memory in under 5 minutes
- [ ] For each step, name the pattern AND why it is used
- [ ] Recite the Phase 9 checkpoint — system walkthrough diagram + every pattern
- [ ] Pick 3 weak areas and answer the "what if it fails?" follow-up for each

### Last 30 min — Mock Answer Drill
- [ ] "Tell me about Node.js error handling" (30s answer + 3 follow-up layers)
- [ ] "How do services communicate?" (outbox + event sourcing + CQRS)
- [ ] "How does your system survive failures?" (rate limit → bulkhead → circuit breaker → retry → idempotency → claim-check → backpressure)
- [ ] "How do you deploy without downtime?" (graceful shutdown → service discovery → rollout strategies → database migrations)
