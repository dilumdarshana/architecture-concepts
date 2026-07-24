# Cancellation and Timeouts

> Cancelling in-flight async tasks and enforcing timeouts to prevent orphaned work, resource leaks, and hung requests.

---

## What is it?

**Cancellation** is the ability to signal an ongoing async operation that its result is no longer needed, so it can stop early and release resources. **Timeouts** impose a deadline — if the operation does not complete within the limit, it is cancelled automatically. In Node.js, `AbortController` and `AbortSignal` provide the standard mechanism.

---

## Problem

Async operations can outlive their usefulness:

- A client disconnects mid-request — the server continues processing a response nobody will read.
- A database query hangs — the connection stays open, exhausting the pool.
- A retry storm starts — duplicate requests are all processed even after the first succeeds.
- A scheduled job is superseded by a newer version — the old job continues consuming CPU and memory.

Without cancellation, every in-flight task that is no longer needed wastes resources, delays other work, and makes graceful shutdown unpredictable.

---

## Example

### AbortController Basics

`AbortController` creates a signal that can be passed to async operations. When `abort()` is called, the signal's `aborted` property becomes `true` and any listeners fire.

```typescript
import { AbortController } from 'node:abort-controller'; // built-in since Node 15

const controller = new AbortController();
const signal = controller.signal;

// Start an async operation that respects the signal
setTimeout(() => {
  controller.abort();
}, 100);

// Consume the signal to cancel work early
async function fetchWithTimeout(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  return response.json();
}

const result = await fetchWithTimeout('/api/data', signal);
```

When the timeout fires, `controller.abort()` is called, `fetch` throws an `AbortError`, and the promise rejects — no network resources are wasted completing a response nobody reads.

### Timeout Pattern with AbortController

A reusable timeout wrapper:

```typescript
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

// Usage
const order = await withTimeout(
  (signal) => prisma.order.findUnique({ where: { id } }, { signal }),
  5_000
);
```

### Cancelling Database Queries (Prisma)

Prisma does not natively support `AbortSignal`, but the underlying driver does for long-running queries:

```typescript
import { Client } from 'pg';
import { AbortController } from 'node:abort-controller';

const controller = new AbortController();
const signal = controller.signal;

const client = new Client({ connectionString: process.env.DATABASE_URL });

// Cancel if the request is disconnected
signal.addEventListener('abort', () => {
  client.query('SELECT pg_cancel_backend(pg_backend_pid())');
}, { once: true });

const result = await client.query('SELECT * FROM inventory FOR UPDATE', { signal });
```

### Cancelling Fetch Requests

Node.js `fetch` (available since Node 18) natively supports `AbortSignal`:

```typescript
async function fetchOrder(orderId: string, signal?: AbortSignal) {
  const response = await fetch(
    `https://api.orders.com/${orderId}`,
    { signal }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// Request with 2-second timeout
app.get('/orders/:id', async (req, res) => {
  try {
    const order = await withTimeout(
      (signal) => fetchOrder(req.params.id, signal),
      2_000
    );
    res.json(order);
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Request timed out' });
      return;
    }
    throw err;
  }
});
```

### Detecting Client Disconnect — Events

Two events detect a client disconnect on the server:

| Event | Fires When | Recommended? |
|-------|------------|--------------|
| `req.on('close')` | Underlying connection closes — disconnect, abort, or socket idle timeout | **Yes** — covers all cases |
| `res.on('close')` | Response stream ends — disconnect OR normal completion | Use with caution; also fires on success |
| `req.on('aborted')` | Client aborts the request (deprecated in Node 17+) | No — use `close` instead |

The `'close'` event fires on both disconnect AND normal completion. Distinguish by checking `req.destroyed` — `true` when the client disconnected, `false` when the response ended normally.

```typescript
import { createServer } from 'http';
import { AbortController } from 'node:abort-controller';

const server = createServer((req, res) => {
  const controller = new AbortController();

  req.on('close', () => {
    if (req.destroyed) {            // client disconnected
      controller.abort();
    }
  });

  // ... pass controller.signal to downstream work
});
```

For keep-alive connections, the socket idle timeout also triggers `close`. Check `req.complete` to distinguish a partial request (client disconnected mid-body) from a complete one:

```typescript
req.on('close', () => {
  if (req.destroyed && !req.complete) {
    // Client disconnected before sending the full body
    controller.abort();
  }
});
```

### Client Disconnect — Express

Express exposes the same `req.on('close')` event on its request object. Combine with `AbortController` to cancel downstream work:

```typescript
app.get('/orders/:id', async (req, res) => {
  const controller = new AbortController();

  req.on('close', () => {
    if (req.destroyed) {
      controller.abort();
    }
  });

  try {
    const order = await fetchOrder(req.params.id, controller.signal);
    res.json(order);
  } catch (err) {
    if (err.name === 'AbortError') return; // Client already left
    throw err;
  }
});
```

---

## Architecture / Flow

```text
Client sends request
        │
        ▼
  Route handler creates AbortController
        │
        ├── Request completes normally ──► return result, cleanup
        │
        └── Client disconnects / timeout
              │
              controller.abort()
              │
              ├── Signal listeners fire
              │     ├── fetch throws AbortError
              │     └── DB query cancellation sent
              │
              └── Catch AbortError → silently ignore
                    (no response sent — client already gone)
```

---

## How it Works

1. Create an `AbortController` instance — it has a `signal` property and an `abort()` method.
2. Pass the `signal` to any async operation that supports it (fetch, streams, event listeners).
3. Call `controller.abort()` when the operation should be cancelled:
   - On a timeout via `setTimeout`.
   - On client disconnect via `req.on('close')` — check `req.destroyed` to distinguish disconnect from normal completion.
   - On a newer superseding event (e.g. stale search query).
4. The signal's `aborted` property becomes `true`, and any `'abort'` event listeners fire.
5. The async operation detects the abort and throws an `AbortError` (or rejects its promise).
6. The caller catches the `AbortError` and handles it (cleanup, no response, etc.).
7. Resources (connections, memory) are freed immediately instead of waiting for the operation to complete.

---

## Advantages

- **Resource efficiency** — cancelled operations stop using CPU, memory, and connections
- **Faster shutdown** — [Graceful Shutdown](graceful-shutdown.md) can abort in-flight work instead of waiting for it
- **Better UX** — clients get timeouts instead of indefinite hangs
- **Standard API** — `AbortController`/`AbortSignal` are built into Node.js and the web platform
- **Composable** — a single `AbortSignal` can be passed to multiple operations and cascade cancellation through a whole flow

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Not all APIs support AbortSignal** — Prisma, some database drivers, and older libraries lack integration | Must implement manual cleanup or use `pg_cancel_backend` patterns |
| **AbortError handling** — every cancellation path must catch `AbortError` specifically | Easy to forget, causing unhandled rejections |
| **Memory overhead** — creating an `AbortController` per request adds allocation cost | Negligible for most applications |
| **Partial cancellation** — some operations cannot be cleanly cancelled mid-way (e.g. file writes) | Must let them finish or accept inconsistent state |
| **Signal propagation** — a cancelled parent should cancel children, but this requires explicit wiring | Libraries like `p-cancelable` or custom wrappers help |

---

## When to Use

- Every HTTP request that performs external I/O (DB, API, file system) — abort on client disconnect
- Background jobs with time budgets — cancel if the job exceeds its allotted time
- Debounced or stale operations — cancel the previous search query when a new one starts
- [Graceful Shutdown](graceful-shutdown.md) — abort in-flight work instead of waiting for it to complete

---

## When NOT to Use

- Short synchronous operations that complete in microseconds
- Operations that have already produced side effects (e.g. a payment charge that has been sent to the provider)
- Systems where timeouts are enforced externally (e.g. API gateway timeout is sufficient)
- Code paths where `AbortError` handling adds more complexity than the resource savings justify

---

## Related Concepts

- [Graceful Shutdown](graceful-shutdown.md) — uses cancellation to abort in-flight work during shutdown
- [Promise APIs](promise-apis.md) — `Promise.race` with a rejection timeout is the pre-AbortController pattern
- [Error Handling (Express)](error-handling.md) — `AbortError` must be caught and handled separately from application errors
- AbortController / AbortSignal
- Fetch API

---

## Key Takeaways

> `AbortController` provides a standard mechanism to cancel async operations in Node.js. Combine it with `setTimeout` for timeouts or `req.on('close')` for client disconnects — check `req.destroyed` to distinguish disconnect from normal completion. Use `req.on('close')` (not the deprecated `'aborted'`) for disconnect detection. Operations that respect `AbortSignal` (fetch, streams) stop immediately; for others (database queries), implement manual cancellation. Always catch `AbortError` explicitly — it is not an application error and should not propagate to error middleware or crash the process.
