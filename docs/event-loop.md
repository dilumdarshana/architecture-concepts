# Event Loop (Node.js)

> The mechanism that enables Node.js to perform non-blocking I/O by offloading operations to the OS kernel and coordinating callbacks across multiple queue phases.

---

## What is it?

The **Event Loop** is the core of Node.js's asynchronous concurrency model. It runs on a single thread, iterating through phases — each with its own queue of pending callbacks — and processes them in a fixed order. **Microtasks** (Promise callbacks, `queueMicrotask`) are drained between each phase, while **macrotasks** (timers, I/O callbacks, setImmediate) belong to specific phases.

The six phases in order:

```text
   ┌───────────────────────────┐
┌─>│        timers             │  setTimeout / setInterval callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │  I/O callbacks deferred to next iteration
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     idle, prepare         │  internal use only
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │         poll              │  retrieve new I/O events, run their callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │         check             │  setImmediate callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     close callbacks       │  close events (socket.on('close'), etc.)
│  └───────────────────────────┘
└────────────────────────────────  loop back to timers
```

---

## Problem

Without understanding the event loop's phase order, developers make mistakes:

- `setTimeout(fn, 0)` and `setImmediate(fn)` behave differently depending on which phase the scheduler is in — using the wrong one breaks intended ordering.
- A `Promise.resolve().then(...)` callback runs before any timer or I/O callback in the next phase — code that relies on timer ordering breaks.
- `process.nextTick` can starve the event loop if called recursively — it is not a phase but an inter-phase microtask queue with higher priority than promises.
- CPU-bound code in a callback blocks every subsequent callback in all queues until it returns.

---

## Example

### Phase Ordering Demonstration

```typescript
console.log('1: sync');

setTimeout(() => console.log('2: timer (macrotask)'), 0);
setImmediate(() => console.log('3: setImmediate (check phase)'));

Promise.resolve().then(() => console.log('4: Promise (microtask)'));

process.nextTick(() => console.log('5: nextTick (highest priority microtask)'));

console.log('6: sync end');

// Output:
// 1: sync
// 6: sync end
// 5: nextTick (highest priority microtask)
// 4: Promise (microtask)
// 2: timer (macrotask)
// 3: setImmediate (check phase)
```

Key ordering rules:
1. **Synchronous code** runs first — the call stack must empty before the event loop starts.
2. **`process.nextTick`** callbacks run after the current operation completes, before any other async callback.
3. **Promise microtasks** (`then`, `catch`, `finally`) run after `nextTick` but before the next phase.
4. **Timers** run in the **timer phase**. `setImmediate` runs in the **check phase** (after poll).
5. `setTimeout(fn, 0)` vs `setImmediate(fn)` — in the main module, the order is non-deterministic. Inside an I/O callback, `setImmediate` always fires first.

### Microtask Starvation

A recursive `process.nextTick` starves the event loop — timer callbacks never get to run:

```typescript
function starve() {
  process.nextTick(starve); // never allows timers to execute
}

setTimeout(() => console.log('Never runs'), 100);
starve(); // event loop is blocked indefinitely
```

`queueMicrotask` or `Promise.resolve().then(...)` have the same risk if called recursively.

### Event Loop Blocking

A CPU-heavy operation in any callback blocks all phases:

```typescript
setTimeout(() => {
  // Blocks the event loop for 2 seconds
  const end = Date.now() + 2000;
  while (Date.now() < end) {}
  console.log('Timer done');
}, 100);

setTimeout(() => console.log('This also waits 2+ seconds'), 200);

// The first timer blocks the event loop — the second timer cannot fire
// until the first timer's callback returns, even though its deadline passes.
```

---

## Architecture / Flow

```text
Call Stack (synchronous execution)
     │
     ▼
┌────────────────────────────────────────────┐
│         Event Loop Iteration                │
│                                              │
│  1. Timer Phase                              │
│     ├── process setTimeout/Interval queues   │
│     └── run callbacks until queue empty      │
│                                              │
│  ──▶ Microtask checkpoint ──────────────────▶│
│      ├── process.nextTick queue (all)        │
│      └── Promise microtask queue (all)       │
│                                              │
│  2. Pending Callbacks Phase                  │
│     └── run deferred I/O callbacks           │
│                                              │
│  ──▶ Microtask checkpoint (same as above)    │
│                                              │
│  3. Idle / Prepare (internal)                │
│                                              │
│  4. Poll Phase                               │
│     ├── calculate blocking time              │
│     ├── process I/O event queue              │
│     └── check for timers/setImmediate        │
│                                              │
│  ──▶ Microtask checkpoint                    │
│                                              │
│  5. Check Phase                              │
│     └── run setImmediate callbacks           │
│                                              │
│  ──▶ Microtask checkpoint                    │
│                                              │
│  6. Close Callbacks Phase                    │
│     └── run close event handlers             │
│                                              │
│  ──▶ Microtask checkpoint                    │
│                                              │
│  Loop back to Timer Phase                    │
└──────────────────────────────────────────────┘
```

---

## How it Works

1. **Synchronous code** executes on the call stack until empty.
2. The event loop begins its first iteration.
3. **Timer phase** — checks expired `setTimeout`/`setInterval` callbacks and runs them in FIFO order. `setImmediate` does **not** run here.
4. **Microtask checkpoint** — after the timer phase, the loop drains the `process.nextTick` queue (entirely) then the Promise microtask queue (entirely). If either queue pushes new items, they are drained too — this is the starvation risk.
5. **Pending callbacks phase** — runs I/O callbacks deferred from the previous poll, such as `TCP error` callbacks.
6. **Microtask checkpoint** — same as step 4.
7. **Idle/Prepare phase** — internal use only.
8. **Poll phase** — waits for new I/O events (network, file system) and runs their callbacks. If no I/O is pending, it checks for scheduled timers:
   - If timers are pending, it jumps to the timer phase.
   - If `setImmediate` callbacks are queued, it jumps to the check phase.
   - Otherwise, it blocks waiting for new I/O (with a calculated timeout based on the nearest timer).
9. **Microtask checkpoint** — same as step 4.
10. **Check phase** — runs all `setImmediate` callbacks.
11. **Microtask checkpoint** — same as step 4.
12. **Close callbacks phase** — runs `close` event handlers (e.g. `socket.on('close')`).
13. **Microtask checkpoint** — same as step 4.
14. The loop continues to the next iteration, starting again at the timer phase.

---

## Advantages

- **Single-threaded simplicity** — no data races (simultaneous memory writes) or lock contention; all application code on one thread avoids the need for mutexes. However, **logic-level race conditions** can still occur when `await` yields the event loop and state changes between operations (see [Race Conditions](nodejs-race-conditions.md)).
- **Deterministic microtask ordering** — `process.nextTick` before Promise callbacks before macrotasks
- **Efficient I/O** — the poll phase blocks waiting for events, using zero CPU while idle
- **Non-blocking by default** — I/O never blocks the call stack; callbacks run when data is ready
- **setImmediate for after-I/O** — schedules work to run immediately after the poll phase completes

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **CPU blocks everything** — a long synchronous operation stalls all phases | Must offload CPU work to worker threads (see [Concurrency vs Parallelism](concurrency-vs-parallelism.md)) |
| **Microtask starvation** — recursive `process.nextTick` prevents timer and I/O callbacks | Always use `setImmediate` for recursive deferrals instead of `nextTick` |
| **Non-deterministic setTimeout vs setImmediate** — in the main module, the order depends on phase state | Use `setImmediate` when you need check-phase ordering; use `setTimeout` for actual delays |
| **nextTick abuse** — `process.nextTick` is not a general-purpose async API; it interrupts the event loop between phases | Reserve it for error handling and boundary conditions; use `queueMicrotask` or `Promise.resolve()` for general deferral |

---

## When to Use

- Understanding the event loop is essential for every Node.js developer — it explains why code runs in the order it does, why CPU work blocks all other callbacks, and how to schedule work correctly.
- Use `setImmediate` when you need callbacks to run after I/O events in the same tick.
- Use `process.nextTick` sparingly — only when you need to run code before Promise microtasks and before the next phase.
- Use `queueMicrotask` for deferring work to the next microtask checkpoint without the high priority of `nextTick`.

---

## When NOT to Use

- Do not use `process.nextTick` for general async deferral — it starves I/O and timer callbacks. Use `setImmediate` or `queueMicrotask`.
- Do not rely on `setTimeout(fn, 0)` vs `setImmediate(fn)` ordering outside of I/O callbacks — the order is not guaranteed.
- Do not run CPU-bound work in any event loop callback — always offload to worker threads (see [Concurrency vs Parallelism](concurrency-vs-parallelism.md)).
- Do not assume microtasks run after every callback — they only run at phase boundaries, not after every individual function call.

---

## Related Concepts

- [Concurrency vs Parallelism](concurrency-vs-parallelism.md) — the event loop provides concurrency but not parallelism; CPU work must be offloaded
- [Promise APIs](promise-apis.md) — Promise callbacks run as microtasks between event loop phases
- [Graceful Shutdown](graceful-shutdown.md) — signal handlers are processed in the event loop; understanding phases helps prevent shutdown hangs
- [Cancellation & Timeouts](cancellation-timeouts.md) — `AbortController` integrates with event loop phases for timely cancellations
- [Race Conditions](nodejs-race-conditions.md) — the event loop's single thread eliminates data races but logic-level races (async interleaving) remain
- libuv
- setImmediate vs setTimeout vs process.nextTick
- Microtask / Macrotask

---

## Key Takeaways

> The event loop has six phases (timers, pending callbacks, idle/prepare, poll, check, close callbacks) with microtask checkpoints between each. `process.nextTick` runs before Promise callbacks, which run before the next phase. CPU-bound operations block all phases — always offload to worker threads. Use `setImmediate` for after-I/O work, `setTimeout` for actual delays, and avoid recursive `process.nextTick` to prevent starvation. The single thread eliminates data races but **logic-level races** (async interleaving) can still occur — see [Race Conditions](nodejs-race-conditions.md).
