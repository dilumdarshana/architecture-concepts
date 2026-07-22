# Node.js Race Conditions

> Logic-level race conditions that occur when async operations interleave on Node.js's single thread, causing shared state to change unexpectedly between `await` calls.

---

## What is it?

A **race condition** in Node.js happens when two or more asynchronous operations access shared state (a variable, cache entry, database row, or stream) in an order that is not guaranteed, producing an incorrect result. Unlike multi-threaded environments where threads literally execute simultaneously (data races), Node.js races are **logic races** — the single thread switches between async tasks at `await` points, and the application state changes between two operations that were written as if they were atomic.

Common patterns that lead to race conditions:
- **Async/await interleaving** — `await` yields the event loop; other handlers run and mutate shared state
- **Read-modify-write across awaits** — read a value, `await` something, then write a new value based on the stale read
- **Stream write-after-end** — calling `write()` on a stream that has already been closed
- **EventEmitter listener races** — multiple async listeners on the same event interleaving
- **Fire-and-forget races** — an async operation continues after its initiating context has changed
- **Shutdown races** — the process starts cleaning up while a new request arrives

---

## Problem

A widespread myth in the Node.js community: *"Node.js is single-threaded, so there are no race conditions."*

This is true for **data races** (two threads simultaneously writing to the same memory address), but false for **logic races**. The event loop serialises execution, but it interleaves async tasks at `await` boundaries. If two request handlers share a module-level counter, this code has a race:

```typescript
let requestCount = 0;

app.get('/api/data', async (req, res) => {
  const current = requestCount;       // read
  await db.fetch(req.params.id);      // yield — another request can increment here
  requestCount = current + 1;         // write — based on stale value
  res.json({ requestNumber: current + 1 });
});
```

Two concurrent requests can both read `requestCount = 0`, both `await`, and both write `requestCount = 1` — one increment is lost.

Without understanding logic races:
- Shared mutable state gets corrupted under load
- Streams throw "write after end" errors intermittently
- Graceful shutdown leaks connections or drops work
- Bugs appear only in production and are nearly impossible to reproduce

---

## Example

### 1. Async/await Interleaving (most common)

A counter that increments on every request:

```typescript
let counter = 0;

async function handleRequest() {
  const snapshot = counter;          // step 1: reads 0
  await someAsyncWork();             // step 2: yields — another request runs
  counter = snapshot + 1;            // step 3: writes 1 (should be 2)
}
```

**Timeline with two concurrent requests:**

```text
Request A                Request B                counter
  │                         │                       0
  │── read counter=0        │                       0
  │                         │── read counter=0      0
  │                         │── await               0
  │── await                 │                       0
  │                         │── write counter=1     1
  │── write counter=1       │                       1  ← lost increment
```

### 2. Stream Write-After-End

```typescript
// gRPC or Node.js writable stream
function sendMessages(call) {
  call.write({ id: 1 });
  call.end();                    // close the stream
  call.write({ id: 2 });        // throws — stream already ended
}
```

### 3. Shared Module State

```typescript
// userCache.ts
export const userCache = new Map<string, User>();

// handler.ts
import { userCache } from './userCache';

async function getUser(id: string) {
  if (userCache.has(id)) {          // check
    await logAccess(id);            // yield — another handler can delete here
    return userCache.get(id);       // use — may return undefined
  }
  const user = await db.fetchUser(id);
  userCache.set(id, user);
  return user;
}
```

### 4. Cancellation Race

```typescript
async function fetchWithTimeout(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  // Between the fetch completing and this line, the signal could abort
  // If the timeout fires after fetch resolves but before we return:
  if (signal.aborted) {
    throw new AbortError();  // false positive — operation actually succeeded
  }
  return response;
}
```

### 5. Shutdown Race

```typescript
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  isShuttingDown = true;
  await server.close();              // stops accepting connections
  await db.disconnect();
});

// A request that started before shutdown flag was set
// but awaits before reading it:
async function handleRequest(req, res) {
  await validate(req);               // yield — shutdown happens here
  if (isShuttingDown) {
    res.status(503).send('Shutting down');
    return;
  }
  await db.save(req.body);           // db might already be disconnected
}
```

---

## Architecture / Flow

```text
Node.js Single Thread

  ┌──────────────────────────────────────────────────────────┐
  │                   Event Loop Iteration                   │
  │                                                          │
  │  ┌──────────┐    await     ┌──────────┐                  │
  │  │ Handler A ├─────────────►   I/O    │  (yields thread) │
  │  │          │              │  (wait)  │                  │
  │  └──────────┘              └──────────┘                  │
  │       │                                                  │
  │       │  Event loop switches to Handler B                │
  │       ▼                                                  │
  │  ┌──────────┐    await     ┌──────────┐                  │
  │  │ Handler B ├─────────────►   I/O    │  (yields thread) │
  │  │          │              │  (wait)  │                  │
  │  └──────────┘              └──────────┘                  │
  │       │                                                  │
  │       │  Handler B mutates shared state                  │
  │       ▼                                                  │
  │  ┌─────────────────────────────────┐                     │
  │  │   Shared State (counter, cache) │  ← corrupted        │
  │  └─────────────────────────────────┘                     │
  │       │                                                  │
  │       │  I/O completes, Handler A resumes                │
  │       ▼                                                  │
  │  ┌──────────┐                                            │
  │  │ Handler A│  (uses stale state)                        │
  │  └──────────┘                                            │
  └──────────────────────────────────────────────────────────┘
```

---

## How it Works

1. **Synchronous code is safe** — while the call stack is non-empty, no other handler can run. Race conditions cannot occur without `await`, `yield`, or a callback.

2. **`await` creates a yield point** — when a handler `await`s a promise, it surrenders the thread. The event loop picks another pending handler and runs it until it yields too.

3. **Shared state is vulnerable between `await`s** — any module-level variable, cache, or object property read before an `await` may be stale after the `await` resumes, because other handlers ran in between.

4. **Stream writes are buffered** — `call.write()` on a gRPC stream or `response.write()` on an HTTP response queues data asynchronously. `call.end()` closes the stream immediately. A write after end throws because the stream's internal state has already transitioned to "closed."

5. **EventEmitter listeners fire in registration order** — but `await` inside a listener lets later listeners run before the first listener's `await` resolves. This breaks any assumption that listeners are processed one at a time.

6. **AbortController fires synchronously** — `signal.aborted` can become `true` between a successful operation completing and the code checking `signal.aborted`, causing a false cancellation.

7. **During shutdown, the event loop keeps processing** — even after setting `isShuttingDown = true`, any handler that started before the flag continues until it hits an `await`. By the time it resumes, the server or database may already be closed.

---

## Advantages

- **No data races** — the single thread eliminates simultaneous memory writes, so shared state is never corrupted at the CPU instruction level
- **Deterministic interleaving** — the event loop's phase order is predictable; races only occur at explicit `await` boundaries
- **No lock contention** — traditional mutexes and semaphores are rarely needed; coordination is simpler than in multi-threaded languages
- **Easy to prevent** — most Node.js races are eliminated by simple patterns: no shared mutable state across `await`, or buffer-then-process
- **Testable** — Node.js race conditions can be reproduced deterministically with controlled async scheduling in tests

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Adding coordination adds complexity** — mutexes, queues, or atomic operations increase code surface and cognitive load | Simple stateless handlers are easier to reason about |
| **Buffering trades latency for safety** — collecting events before processing delays the response | Not suitable for real-time or streaming use cases |
| **Atomic DB operations shift the bottleneck** — using `UPDATE ... SET x = x + 1` is safe but serialises writes on the row | Throughput may be limited by row-level contention |
| **Mutexes can deadlock** — if two async functions each acquire a mutex and then await the other, neither makes progress | Requires careful ordering or a deadlock detection strategy |
| **Over-engineering** — not every shared variable needs protection; short-lived state that is read once and discarded is safe | Premature coordination adds unnecessary complexity |

---

## When to Use

- **Shared mutable state across `await`** — counters, caches, registries, or accumulators that are read before and written after an `await`
- **Stream ending before write** — any code that conditionally calls `.write()` on a gRPC call, HTTP response, or Node.js `WritableStream`
- **Graceful shutdown** — when draining in-flight work while new requests can arrive concurrently
- **EventEmitter with async listeners** — when multiple listeners on the same event perform async work that mutates shared state
- **Concurrent cache population** — when multiple handlers can compute and write the same cache key simultaneously (stampede prevention)
- **Cancellation boundaries** — when an operation can complete successfully at the same moment a timeout fires
- **Fire-and-forget tasks** — when an async task continues after its caller has moved on and the task reads mutable state

---

## When NOT to Use

- **Stateless handlers** — if a handler reads input, calls `await`, and returns a result without touching shared state, there is nothing to race on
- **Immutable state** — values that are set once and never mutated (configuration, constants, connection strings) are safe
- **Single-operation async** — if there is exactly one `await` in the handler and no shared state between the request and the `await`, no race exists
- **Database-level concurrency control** — if the DB handles atomicity (e.g., `UPDATE ... SET x = x + 1`), the application does not need a mutex for that operation
- **Read-only state** — if multiple handlers read the same cache or map without writing, there is no race
- **Low-traffic services** — a service processing a few requests per second is unlikely to hit interleaving races in practice (though they are still theoretically possible)

---

## Prevention Patterns

### Buffer-then-Process

Collect all events before starting async work:

```typescript
function sumNumbers(call: any, callback: any) {
  const buffer: number[] = [];

  call.on('data', (req: any) => { buffer.push(req.number); });
  call.on('end', () => {
    const sum = buffer.reduce((a, b) => a + b, 0);
    callback(null, { sum });
  });
}
```

### Atomic Database Operations

Delegate atomicity to the database instead of read-modify-write:

```typescript
// Unsafe — read, await, write (race window)
const count = await db.counter.findUnique({ where: { id: 1 } });
await someAsyncWork();
await db.counter.update({
  where: { id: 1 },
  data: { value: count.value + 1 }
});

// Safe — database does it atomically
await db.counter.update({
  where: { id: 1 },
  data: { value: { increment: 1 } }
});
```

### Mutex for In-Memory State

Use `async-mutex` for critical sections that span `await`:

```typescript
import { Mutex } from 'async-mutex';

const cacheMutex = new Mutex();

async function getOrCompute(key: string) {
  return await cacheMutex.runExclusive(async () => {
    if (cache.has(key)) return cache.get(key);
    const value = await expensiveComputation(key);
    cache.set(key, value);
    return value;
  });
}
```

### Guard Stream State

Track whether a stream has ended to prevent write-after-end:

```typescript
function getNumbers(call: any) {
  let ended = false;

  const timer = setInterval(() => {
    if (ended) return;
    if (current > count) {
      clearInterval(timer);
      call.end();
      ended = true;
      return;
    }
    call.write({ order: current, number: current * 100 });
    current++;
  }, 1000);

  call.on('error', () => { ended = true; });
}
```

### Check-then-Act with AbortController

Avoid the race between completion and cancellation:

```typescript
async function fetchWithTimeout(url: string, signal: AbortSignal) {
  // Use AbortSignal.timeout() which aborts the fetch itself
  // rather than checking after completion
  const response = await fetch(url, { signal });
  return response;  // If fetch succeeded, signal doesn't matter
}
```

### Shutdown with In-Flight Tracking

Track active requests and only close resources after they drain:

```typescript
const inFlight = new Set<Request>();

server.on('request', (req) => {
  inFlight.add(req);
  req.on('close', () => inFlight.delete(req));
});

process.on('SIGTERM', async () => {
  server.close();                  // stop accepting new requests
  // Wait for existing requests to finish (with timeout)
  await Promise.race([
    waitForEmpty(inFlight),
    new Promise(r => setTimeout(r, 10_000))
  ]);
  await db.disconnect();
  process.exit(0);
});
```

---

## Decision Tree

```text
Do you share mutable state across await?
  │
  ├── No  → No race condition risk. Proceed.
  │
  └── Yes → Can the state be moved into the database?
              │
              ├── Yes → Use atomic DB operations (UPDATE ... SET x = x + 1).
              │
              └── No  → Is the state per-request or global?
                          │
                          ├── Per-request → Use buffer-then-process pattern.
                          │
                          └── Global → Add a mutex or use atomic primitives.
```

---

## Related Concepts

- [Event Loop](event-loop.md) — the single-threaded model that serialises execution but creates async interleaving at `await` boundaries
- [Promise APIs](promise-apis.md) — `Promise.all` and `Promise.race` can introduce or prevent race conditions depending on how they are used
- [Database Concurrency Control](database-concurrency-control.md) — database-level atomic operations, pessimistic and optimistic locking for safe concurrent access
- [Graceful Shutdown](graceful-shutdown.md) — shutdown races between in-flight requests and resource cleanup
- [Cancellation & Timeouts](cancellation-timeouts.md) — the racing abort problem when timeouts fire at the same moment as successful completion
- [Caching Strategies](caching-strategies.md) — cache stampede prevention and write-write conflicts in concurrent cache access
- [Concurrency vs Parallelism](concurrency-vs-parallelism.md) — distinguishes the concurrency model (event loop) from parallelism (worker threads), and why both can have race conditions
- [Claim-Check Pattern](claim-check-pattern.md) — uses database-level atomic claims to prevent concurrent processing without in-process mutexes
- [Node.js Event Emitter](nodejs-event-emitter.md) — async listener interleaving and fire-and-forget race hazards
- [gRPC](../grpc/README.md) — stream write-after-end race conditions and per-call event serialisation

---

## Key Takeaways

> Node.js eliminates data races (simultaneous memory writes) but **logic-level race conditions** are real and common — they occur when `await` yields the event loop and shared state changes between two operations that were written as atomic. The most common fix is to eliminate shared mutable state across `await` boundaries: buffer before processing, delegate atomicity to the database, or use a mutex for in-memory critical sections. Stateless handlers and immutable state are immune. The decision tree is simple: if there is no shared mutable state across an `await`, there is no race.
