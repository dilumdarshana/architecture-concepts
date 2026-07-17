# Retry Pattern

> A strategy for re-executing failed operations with controlled delays — using exponential backoff and jitter to handle transient failures without overwhelming the system.

---

## What is it?

The Retry Pattern automatically retries a failed operation after a delay, progressively increasing the wait time between attempts (exponential backoff) and adding randomness (jitter) to prevent retry storms. It distinguishes transient failures (network blip, deadlock, rate limit) from permanent ones (invalid input, missing resource) and gives up after a configurable limit.

---

## Problem

Transient failures are inevitable in distributed systems. A network packet drops, a database deadlock kills a transaction, a rate limiter rejects a request, or a downstream service is momentarily overwhelmed. Without retries:

- **Manual recovery** — operators must detect and replay failed operations
- **Data loss** — events are silently dropped when delivery fails
- **Cascading failures** — a brief hiccup becomes a crash because no recovery mechanism exists

Naive retries (immediate, unlimited) make things worse. The **thundering herd problem** — all clients retry simultaneously — amplifies load on an already-struggling service.

---

## Example

### Simple Retry with Exponential Backoff

```typescript
async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt),   // exponential backoff
        10_000                                 // cap at 10s
      );
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### Adding Jitter

Without jitter, retries align across clients, creating spikes. Full jitter randomizes each delay:

```typescript
const delay = Math.min(
  baseDelayMs * Math.pow(2, attempt),
  10_000
);
const jittered = Math.random() * delay;  // full jitter: [0, delay)
await sleep(jittered);
```

### BullMQ Built-In Retry

BullMQ supports backoff natively:

```typescript
import { Queue, Worker } from 'bullmq';

const queue = new Queue('payments', {
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000  // base delay in ms
    }
  }
});

const worker = new Worker('payments', async (job) => {
  const result = await chargeCustomer(job.data);
  return result;
}, {
  // Remove job after last attempt
  removeOnComplete: true,
  removeOnFail: { count: 100 }
});
```

The worker emits failure events for monitoring:

```typescript
worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed attempt ${job.attemptsMade}:`, err);
  if (job.attemptsMade >= job.opts.attempts!) {
    // Notify dead letter queue or admin
    notifyOps(`Job permanently failed: ${job.id}`);
  }
});
```

---

## Architecture / Flow

```text
Caller                     Retry Logic                 Downstream
  │                            │                          │
  │  invoke                    │                          │
  │ ─────────────────────────► │                          │
  │                            │  request                 │
  │                            │ ────────────────────────► │
  │                            │  error/timeout           │
  │                            │ ◄──────────────────────── │
  │                            │                          │
  │                            │  wait baseDelay * 2^0    │
  │                            │  + jitter                │
  │                            │  ────┐                    │
  │                            │      │                    │
  │                            │ ◄────┘                    │
  │                            │                          │
  │                            │  retry request           │
  │                            │ ────────────────────────► │
  │                            │  error (rate limit)      │
  │                            │ ◄──────────────────────── │
  │                            │                          │
  │                            │  wait baseDelay * 2^1    │
  │                            │  + jitter                │
  │                            │  ────┐                    │
  │                            │      │                    │
  │                            │ ◄────┘                    │
  │                            │                          │
  │                            │  retry request           │
  │                            │ ────────────────────────► │
  │                            │  success                 │
  │                            │ ◄──────────────────────── │
  │  result                    │                          │
  │ ◄───────────────────────── │                          │
```

### Jitter Strategies

| Strategy | Formula | Behaviour |
|----------|---------|-----------|
| No jitter | `delay = min(cap, base * 2^n)` | All clients retry in sync |
| Full jitter | `delay = random(0, min(cap, base * 2^n))` | Spreads retries evenly |
| Equal jitter | `delay = min(cap, base * 2^n) / 2 + random(0, min(cap, base * 2^n) / 2)` | Middle ground |
| Decorrelated jitter | `delay = min(cap, random(base, prev * 3))` | Natural spread, good for long backoff |

---

## How it Works

1. An operation is attempted and fails with a retryable error (timeout, 503, deadlock, rate limit).
2. The retry logic checks if the attempt count is below the configured max retries.
3. A delay is calculated: `baseDelay * 2^attempt` (exponential backoff), capped at a maximum.
4. Jitter is applied to the delay — usually full jitter multiplies it by `Math.random()`.
5. The caller waits for the jittered delay duration.
6. The operation is retried.
7. If it succeeds, the result is returned and retry state is discarded.
8. If it fails again, steps 2-6 repeat.
9. If max retries are exhausted, the error is propagated to the caller.
10. The permanent failure may be routed to a dead letter queue for manual inspection.

---

## Advantages

- **Resilience** — automatic recovery from transient failures without manual intervention
- **Thundering herd prevention** — exponential backoff + jitter spreads retries across time
- **Rate limit respect** — backoff gives rate limit windows time to reset
- **Operational simplicity** — declarative retry config (BullMQ) eliminates boilerplate
- **Composability** — pairs naturally with Circuit Breaker, Idempotency, and Timeouts

---

## Trade-offs

- **Latency** — failed operations take longer to complete (backoff delays add up)
- **Amplified load under sustained failure** — retries add traffic even when the downstream is down (mitigate with [Circuit Breaker](circuit-breaker.md))
- **State management** — retry counts, timers, and dead letters require storage in durable systems
- **Not for permanent failures** — retrying invalid input or missing resources wastes cycles
- **Idempotency required** — retries re-execute the operation; side effects must be safe (see [Idempotency](idempotency.md))

---

## When to Use

- Network calls to external APIs or microservices where transient failures are expected
- Database operations that may deadlock or timeout under contention
- Message queue consumers that encounter processing errors (use BullMQ built-in retry)
- Any operation with at-least-once delivery semantics (see [Delivery Semantics](delivery-semantics.md))
- Background jobs where a delay is acceptable (emails, notifications, report generation)

---

## When NOT to Use

- **Read-only idempotent calls** — a single retry with short timeout is sufficient; exponential backoff adds unnecessary latency
- **Real-time systems** — the cumulative delay of multiple retries may exceed the response budget
- **Non-retryable errors** — 4xx client errors (400, 404, 422) indicate permanent failures
- **Operations with side effects** — without [Idempotency](idempotency.md), retries cause duplicate charges, duplicate emails, etc.
- **When the downstream is down** — retrying a dead service wastes resources; use a [Circuit Breaker](circuit-breaker.md) to fail fast

---

## Related Concepts

- [Circuit Breaker](circuit-breaker.md) — prevents retries when a downstream service is known to be unhealthy
- [Idempotency](idempotency.md) — retries must be idempotent to avoid duplicate side effects
- [Cancellation & Timeouts](cancellation-timeouts.md) — timeouts bound how long a single attempt can take
- [Delivery Semantics](delivery-semantics.md) — retries enable at-least-once delivery
- [Claim-Check Pattern](claim-check-pattern.md) — database-level retry for consumer claims
- Dead Letter Queue — stores permanently failed messages for manual inspection

---

## Key Takeaways

> Retries with exponential backoff and jitter provide automatic recovery from transient failures. Exponential backoff prevents aggressive retry storms; jitter prevents synchronized retry spikes. Always cap retries at a reasonable limit and combine with Circuit Breaker to avoid amplifying load on a failing system. Every retry must be paired with [Idempotency](idempotency.md) to guarantee safety on re-execution.
