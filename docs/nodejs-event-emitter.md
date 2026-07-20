# Node.js Event Emitter

> The observer pattern at the heart of Node.js — enabling decoupled communication between objects through named events and listeners.

---

## What is it?

The `EventEmitter` class from Node.js's `events` module implements the observer pattern: objects emit named events, and registered listeners (callbacks) are invoked when those events fire. This pattern is foundational — Node.js's HTTP server, streams, child processes, and many other built-in modules extend `EventEmitter`. Custom application code can use it to decouple components without tight imports or direct function calls.

---

## Problem

In a Node.js application, components need to communicate when something happens — a file finishes reading, a client connects, a database query returns. Without an event system:

- **Tight coupling** — the file reader must know who to call when it finishes, creating circular dependencies
- **No broadcast** — a single event (e.g. "user registered") needs to notify email, analytics, and audit modules individually
- **No lifecycle hooks** — streams and connections have start, data, end, and error phases that need separate handlers
- **Manual callback management** — every new listener requires modifying the emitter's code

The EventEmitter solves this by separating the source of events from its consumers — any number of listeners can subscribe without the emitter knowing about them.

---

## Example

### Basic Usage

```typescript
import { EventEmitter } from 'events';

const orderEmitter = new EventEmitter();

// Register listeners (subscribers)
orderEmitter.on('order:placed', (order) => {
  console.log(`Email sent for order ${order.id}`);
});

orderEmitter.on('order:placed', (order) => {
  console.log(`Analytics tracked for order ${order.id}`);
});

// Emit the event (publisher)
orderEmitter.emit('order:placed', { id: '123', total: 50 });
// Both listeners fire in registration order
```

### Extending EventEmitter

Built-in Node.js modules extend `EventEmitter` so instances can emit events directly:

```typescript
import { EventEmitter } from 'events';

class PaymentService extends EventEmitter {
  async processPayment(orderId: string, amount: number) {
    try {
      const charge = await stripe.charges.create({ amount });
      this.emit('payment:succeeded', { orderId, chargeId: charge.id });
      return charge;
    } catch (err) {
      this.emit('payment:failed', { orderId, error: err.message });
      throw err;
    }
  }
}

const payments = new PaymentService();

payments.on('payment:succeeded', ({ orderId, chargeId }) => {
  console.log(`Order ${orderId} charged: ${chargeId}`);
});

payments.on('payment:failed', ({ orderId, error }) => {
  console.error(`Order ${orderId} failed: ${error}`);
});

await payments.processPayment('order-123', 5000);
```

---

## API Reference

### Core Methods

| Method | Description |
|--------|-------------|
| `emitter.on(event, listener)` | Register a listener for an event |
| `emitter.once(event, listener)` | Register a listener that fires at most once, then removes itself |
| `emitter.emit(event, ...args)` | Emit an event — calls all registered listeners synchronously with the provided arguments |
| `emitter.off(event, listener)` | Remove a specific listener (alias: `removeListener`) |
| `emitter.removeAllListeners(event?)` | Remove all listeners for an event (or all events if no event specified) |
| `emitter.listeners(event)` | Return a copy of the array of listeners for an event |
| `emitter.eventNames()` | Return an array of events that have registered listeners |
| `emitter.listenerCount(event)` | Return the number of listeners for an event |
| `emitter.setMaxListeners(n)` | Change the max listener warning threshold (default 10) |
| `emitter.rawListeners(event)` | Return a copy of the listener array including any wrappers (e.g. `once`-wrapped listeners) |

### Event Names

Events are strings. By convention, use colon-separated namespacing: `user:created`, `order:shipped`, `payment:failed`. The `error` event is special — if emitted and no listener is registered, the process throws.

### Error Event

```typescript
const emitter = new EventEmitter();

// If no 'error' listener exists, emit('error') throws
emitter.emit('error', new Error('Something broke'));
// Uncaught: Error: Something broke
//           Emitted 'error' event on EventEmitter instance at: ...

// With an error listener, it is handled gracefully
emitter.on('error', (err) => {
  console.error('Recovered from:', err.message);
});
emitter.emit('error', new Error('Something broke'));
// Output: Recovered from: Something broke
```

**Rule:** Always register an `error` listener on any EventEmitter you create. An unhandled `error` event crashes the process.

---

## How it Works

1. An `EventEmitter` instance maintains an internal map: `Map<string, Function[]>` — each event name maps to an array of listener functions.
2. When `emitter.on(event, listener)` is called, the listener is pushed onto the array for that event.
3. When `emitter.once(event, listener)` is called, the listener is wrapped in a function that calls `this.off(event, wrappedListener)` before invoking the original listener.
4. When `emitter.emit(event, ...args)` is called, the emitter looks up the array of listeners for that event and calls each listener **synchronously** in registration order with the provided arguments.
5. If the event is `error` and no listener is registered, the emitter throws the error — this is the only event with special behaviour.
6. When `emitter.off(event, listener)` is called, the listener is removed from the array by reference equality.

```text
emitter.on('data', handler1)
emitter.on('data', handler2)
emitter.once('data', handler3)

Internal state:
  Map {
    'data' => [handler1, handler2, handler3 (wrapped with once)]
  }

emitter.emit('data', 'hello')
  → handler1('hello')     ← synchronous
  → handler2('hello')     ← synchronous
  → handler3('hello')     ← synchronous, then removed

emitter.emit('data', 'world')
  → handler1('world')
  → handler2('world')
  // handler3 is gone (once)
```

### Synchronous Emission

Listeners are called synchronously by `emit()`. This means `emit` blocks until all listeners finish. For async work inside listeners, the listeners themselves manage async:

```typescript
emitter.on('event', async () => {
  await someAsyncWork(); // fire-and-forget — emitter does not await this
});
emitter.emit('event');
// emit() returns immediately — the async listener runs on its own
```

The emitter provides no built-in mechanism to wait for async listeners. If you need that, use an asynchronous event bus pattern or `Promise.all` on the return values.

---

## Memory Leak Prevention

### The Warning

By default, EventEmitter warns when more than 10 listeners are registered on a single event:

```typescript
const emitter = new EventEmitter();
for (let i = 0; i < 15; i++) {
  emitter.on('data', () => {});
}
// (node:12345) MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
// 15 data listeners added. Use emitter.setMaxListeners() to increase limit
```

This is a **memory leak detection heuristic**, not a hard limit. It catches cases where a module registers a new listener on every function call without cleaning up.

### Proper Cleanup

Always remove listeners when they are no longer needed — especially in long-lived processes:

```typescript
class Connection {
  private emitter: EventEmitter;

  onData(handler: (data: Buffer) => void) {
    this.emitter.on('data', handler);
    // Return a cleanup function
    return () => this.emitter.off('data', handler);
  }

  close() {
    this.emitter.removeAllListeners();
  }
}

// In calling code
const conn = new Connection();
const cleanup = conn.onData((data) => process(data));

// Later — cleanup to prevent leak
cleanup();
```

### MaxListeners

Adjust the warning threshold when many listeners is intentional:

```typescript
const emitter = new EventEmitter();
emitter.setMaxListeners(50); // no warning until 50 listeners
```

Or disable the warning entirely (not recommended):

```typescript
emitter.setMaxListeners(Infinity);
```

---

## Where EventEmitter Lives in Node.js

Many built-in Node.js APIs extend EventEmitter:

| API | Key Events |
|-----|------------|
| `http.Server` | `request`, `connection`, `close`, `error` |
| `http.ClientRequest` | `response`, `error`, `close`, `abort` |
| `stream.Readable` | `data`, `end`, `close`, `error`, `pause`, `resume` |
| `stream.Writable` | `drain`, `finish`, `close`, `error`, `pipe`, `unpipe` |
| `net.Socket` | `data`, `end`, `connect`, `close`, `error`, `drain`, `timeout` |
| `child_process.ChildProcess` | `exit`, `close`, `error`, `message`, `disconnect` |
| `readline.Interface` | `line`, `close`, `pause`, `resume` |
| `process` (global) |`exit`, `beforeExit`, `uncaughtException`, `unhandledRejection`, `SIGTERM`, `SIGINT` |

---

## EventEmitter vs Callbacks vs Streams

| Pattern | When to Use | Example |
|---------|-------------|---------|
| **EventEmitter** | Multiple listeners, repeated events, lifecycle hooks | HTTP server `request` event |
| **Callback** | Single completion, request-response pattern | `fs.readFile(path, cb)` |
| **Stream** | Data arrives in chunks over time | `fs.createReadStream().on('data', ...)` |

---

## Advantages

- **Decoupling** — emitter does not know about its listeners; listeners do not know about each other
- **Multiple subscribers** — any number of listeners can subscribe to the same event
- **Familiar pattern** — extends across the entire Node.js ecosystem; every Node.js developer recognises EventEmitter-based APIs
- **Flexible lifecycle** — `once`, `off`, `removeAllListeners` give fine-grained control
- **Low overhead** — synchronous dispatch is fast; the event map is a simple object lookup

---

## Trade-offs

- **Synchronous emission** — all listeners block the emitter; use async listeners carefully
- **No built-in error propagation** — if one listener throws, subsequent listeners do not run (use try/catch inside listeners)
- **Memory leaks** — forgotten `on` registrations are a common source of leaks in long-running processes
- **Event name collisions** — any string can be emitted; no type safety without TypeScript enums or a wrapper
- **No backpressure** — if a listener is slow, there is no mechanism to slow down the emitter

---

## When to Use

- **Decoupling components** — a module emits events and multiple unrelated modules react independently
- **Plugin/extension systems** — allow third-party code to hook into lifecycle events
- **Streaming data** — process data as it arrives in chunks (files, network sockets, HTTP bodies)
- **Lifecycle hooks** — emit `start`, `progress`, `complete`, `error`, `close` events around long-running operations
- **Event-driven workflow engines** — emit named events at each step; listeners trigger the next step

---

## When NOT to Use

- **Request-response flows** — a function should return a value; use async/await instead of emitting a result event
- **Single listener per event** — a callback or Promise is simpler and more explicit
- **High-frequency events** (thousands per second) — EventEmitter dispatch overhead per event can become significant
- **Cross-process communication** — use a message queue (BullMQ, Kafka, SQS) instead of EventEmitter across process boundaries

---

## Related Concepts

- [Event Loop](event-loop.md) — EventEmitter listeners run synchronously on the call stack, subject to event loop phase ordering
- [Error Handling (Express)](error-handling.md) — patterns for handling errors in async event-driven code
- [Streams] — built on EventEmitter; every stream emits `data`, `end`, `error`, `close`
- [Graceful Shutdown](graceful-shutdown.md) — the `process` global EventEmitter emits `SIGTERM`/`SIGINT` that trigger shutdown
- [Event-Driven Architecture](event-driven-architecture.md) — EventEmitter is the intra-process event bus; EDA is the inter-service event architecture

---

## Key Takeaways

> EventEmitter is the foundation of Node.js's asynchronous, event-driven nature. It decouples event producers from consumers — any number of listeners can subscribe without the emitter knowing about them. Listeners are called synchronously in registration order. Always register an `error` listener to avoid process crashes. Remove listeners when they are no longer needed to prevent memory leaks. EventEmitter powers Node.js's core APIs (HTTP, streams, sockets, child processes) and is available for custom application-level pub/sub within a single process — for cross-process communication, use a message queue instead.
