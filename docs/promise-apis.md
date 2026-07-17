# JavaScript Promise APIs

> Static methods for composing, coordinating, and managing the lifecycle of multiple asynchronous operations.

---

## What is it?

JavaScript provides six static Promise methods — `all`, `allSettled`, `race`, `any`, `resolve`, and `reject` — that control how multiple async tasks are handled. Each method offers a different strategy for waiting, failing, and collecting results.

| API | Short-circuits on | Returns |
|-----|-------------------|---------|
| `Promise.all` | First rejection | Array of all fulfilled values |
| `Promise.allSettled` | Never | Array of `{status, value/reason}` |
| `Promise.race` | First settlement (any) | The first settled value or reason |
| `Promise.any` | First fulfillment | The first fulfilled value |
| `Promise.resolve` | — | A promise resolved with the given value |
| `Promise.reject` | — | A promise rejected with the given reason |

---

## Problem

Asynchronous code often needs to coordinate multiple operations: fetch data from several APIs, run tasks in parallel, or proceed as soon as the first result arrives. Without these APIs:

- Sequential `await` wastes time on I/O that could run concurrently.
- Error handling becomes verbose — try/catch around every individual call.
- There is no standard way to "proceed when the first completes" or "collect all results even if some fail."
- Callback-based coordination leads to deeply nested, unreadable code.

---

## Example

A service that must fetch user details, order history, and product recommendations simultaneously:

```text
Without Promise.all (sequential — slow):
  Fetch user          ──► 200ms
  Fetch orders        ──► 150ms  (waits for user)
  Fetch recommend.    ──► 200ms  (waits for orders)
  Total: 550ms

With Promise.all (concurrent — fast):
  Fetch user          ──► 200ms
  Fetch orders        ──► 150ms  │
  Fetch recommend.    ──► 200ms  │  (parallel)
  Total: 200ms
```

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Concurrent — all three run at the same time
const [user, orders, recommendations] = await Promise.all([
  prisma.user.findUnique({ where: { id: userId } }),
  prisma.order.findMany({ where: { userId } }),
  getRecommendations(userId)
]);

// allSettled — collect results even if some fail
const results = await Promise.allSettled([
  fetch('https://api.payment.com/charge'),
  fetch('https://api.analytics.com/track'),
]);

for (const result of results) {
  if (result.status === 'fulfilled') {
    console.log('Success:', result.value);
  } else {
    console.error('Failed:', result.reason);
  }
}

// race — timeout pattern: reject if the operation takes too long
const data = await Promise.race([
  fetchOrder(orderId),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), 5000)
  )
]);

// any — try multiple sources, take the first successful one
const price = await Promise.any([
  fetchPriceFromCache(productId),
  fetchPriceFromDb(productId),
  fetchPriceFromApi(productId),
]);
```

---

## Architecture / Flow

```text
Promise.all — wait for all, fail fast on any error

  Task A ────────► resolve        ┌── all resolved ──► [A, B, C]
  Task B ──────► resolve ────────►│
  Task C ──► reject ──────────────┘── rejects immediately

Promise.allSettled — wait for all, never fail

  Task A ────────► resolve        ┌── all settled ──►
  Task B ──────► reject  ────────►│   [{fulfilled,A}, {rejected,B}]
  Task C ──► resolve              ┘

Promise.race — first settlement wins (resolve or reject)

  Task A ─────────────► resolve   ┌── first to settle
  Task B ────► reject             │   (whichever is faster)
  Task C ────────────────────►    ┘

Promise.any — first fulfillment wins, ignore rejections

  Task A ─────────────► resolve   ┌── first to resolve
  Task B ────► reject  (ignored)  │   (rejections are ignored)
  Task C ──► reject   (ignored)   ┘   unless all reject
```

---

## How it Works

1. Create an array of promises representing the async tasks.
2. Pass the array to the chosen Promise API method.
3. The method subscribes to all promises internally.
4. Each promise transitions to settled (fulfilled or rejected) independently.
5. The method's behavior depends on which API was called:
   - **`all`** — resolves when all fulfill; rejects immediately on any rejection.
   - **`allSettled`** — resolves when all settle (each result annotated with status).
   - **`race`** — settles as soon as the first promise settles (fulfill or reject).
   - **`any`** — resolves when the first promise fulfills; rejects with `AggregateError` only if all reject.
6. The caller awaits the resulting promise and handles the output.

---

## Advantages

- **Concurrent I/O** — `Promise.all` reduces wall-clock time by running independent tasks in parallel
- **Graceful degradation** — `Promise.allSettled` lets partial failures coexist with successful results
- **Fast failure** — `Promise.race` enables timeouts and circuit-breaking
- **Resilience** — `Promise.any` supports fallback strategies across redundant sources
- **Standardized** — no need for external libraries for basic coordination patterns
- **Composable** — can be nested and combined for complex workflows

---

## Trade-offs

| API | Trade-off |
|-----|-----------|
| **`all`** | Fail-fast can be wasteful — one slow failure discards all other in-flight results |
| **`allSettled`** | No automatic error propagation — must inspect each result manually |
| **`race`** | The losing promises continue executing (fire-and-forget); cannot cancel them |
| **`any`** | Silent rejection — downstream has no visibility into which sources failed unless logged |
| General | Promises are eager — they start executing as soon as created, not when awaited |

---

## When to Use

| API | Use Case |
|-----|----------|
| **`all`** | Fetching related data where all pieces are required — dashboard page, order details with line items |
| **`allSettled`** | Bulk operations where partial success is acceptable — sending batch notifications, syncing multiple external systems |
| **`race`** | Timeouts, health checks, competing requests (try the fastest replica) |
| **`any`** | Multi-source fallback — read from cache, then DB, then API; try multiple CDN endpoints |

---

## When NOT to Use

- **`Promise.all`** — avoid when some operations can fail without blocking the overall result (use `allSettled` instead).
- **`Promise.race`** — avoid when you need the first successful result specifically (use `any`).
- **`Promise.any`** — avoid when you need to know which sources failed (log separately or use `allSettled`).
- Never use these APIs for CPU-bound work — they provide concurrency, not parallelism. Offload CPU work to worker threads (see [Concurrency vs Parallelism](concurrency-vs-parallelism.md)).

---

## Related Concepts

- [Concurrency vs Parallelism](concurrency-vs-parallelism.md) — Promise APIs provide concurrent I/O, not parallel CPU execution
- [Distributed Systems](distributed-systems.md) — services use `Promise.all` for parallel data fetching across internal services
- Async / Await
- Event Loop
- Callback Pattern
- Observable (RxJS)

---

## Key Takeaways

> Promise APIs (`all`, `allSettled`, `race`, `any`) provide standardized strategies for coordinating multiple async operations. `Promise.all` runs tasks concurrently and fails fast; `allSettled` tolerates partial failures; `race` and `any` give you the first result under different criteria. They handle I/O concurrency only — CPU-bound work still needs worker threads.
