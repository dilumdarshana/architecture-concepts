# Concurrency vs Parallelism

> Concurrency is about dealing with many things at once; parallelism is about doing many things at once.

---

## What is it?

**Concurrency** is the composition of independently executing tasks — they make progress in overlapping time periods but may not run simultaneously. **Parallelism** is the simultaneous execution of multiple tasks, typically on multiple CPU cores.

A system can be concurrent without being parallel (single-core time-slicing) and parallel without being concurrent (SIMD vector instructions). The two concepts are orthogonal.

| | Concurrency | Parallelism |
|--|-------------|-------------|
| Focus | Structure (managing multiple tasks) | Execution (running tasks simultaneously) |
| Hardware | Single core or multi-core | Requires multi-core |
| Node.js | Event loop + async I/O | Worker threads for CPU-bound work |

---

## Problem

Applications often need to handle multiple tasks at once — serve many HTTP requests, read from the database while processing another request, or crunch large datasets. Without understanding the distinction:

- Developers reach for threads when async I/O is sufficient, adding unnecessary complexity.
- Developers assume async always means "faster" for CPU-bound work (it does not).
- Services bottleneck on a single core when parallel CPU work is needed.
- Callbacks and blocking I/O lead to poor resource utilization.

---

## Example

A restaurant kitchen analogy:

```text
Concurrency (one chef):
  ┌── Toast ──┐
  │  (wait)   │
  ├── Eggs ───┤
  │  (wait)   │
  └── Coffee ─┘
  Sequential = slow

Concurrent (one chef, interleaved):
  ┌── Toast ──┐
  ├─ Eggs ────┤  (while toast is toasting)
  ├─ Coffee ──┤  (while eggs are cooking)
  Single core, overlapping waits = faster throughput

Parallel (two chefs):
  Chef A: ── Toast ── Eggs ──
  Chef B: ── Coffee ───── Toast ──
  Two cores, truly simultaneous = fastest
```

In Node.js, the event loop provides concurrency for I/O-bound tasks, while `worker_threads` provides parallelism for CPU-bound work:

```typescript
import { createServer } from 'http';
import { Worker } from 'worker_threads';
import { readFile } from 'fs/promises';

// Concurrent: event loop handles many I/O requests
const server = createServer(async (req, res) => {
  if (req.url === '/api/data') {
    // Non-blocking I/O — event loop stays free
    const data = await readFile('./data.json', 'utf-8');
    res.end(data);
  }

  if (req.url === '/api/hash') {
    // CPU-bound — offload to worker thread for true parallelism
    const worker = new Worker('./hash-worker.js', {
      workerData: req.headers['x-input']
    });
    worker.on('message', (hash) => res.end(hash));
  }
});

server.listen(3000);
```

```typescript
// hash-worker.js — runs on a separate core
import { parentPort, workerData } from 'worker_threads';
import { createHash } from 'crypto';

const hash = createHash('sha256').update(workerData).digest('hex');
parentPort!.postMessage(hash);
```

---

## Architecture / Flow

```text
Node.js Process (single thread)
┌─────────────────────────────────────────┐
│               Event Loop                 │
│  ┌──────┐  ┌──────┐  ┌──────┐          │
│  │ req1 │  │ req2 │  │ req3 │  ...      │  Concurrent I/O
│  └──┬───┘  └──┬───┘  └──┬───┘          │
│     │         │         │               │
│     ▼         ▼         ▼               │
│  readFile   queryDB   httpCall          │  Non-blocking
│     │         │         │               │
│     └─────────┼─────────┘               │
│               │ callback/task           │
│               ▼                         │
│         ┌──────────┐                    │
│         │ response │                    │
│         └──────────┘                    │
└─────────────────────────────────────────┘

Worker Thread Pool (parallel CPU)
┌──────────┐  ┌──────────┐  ┌──────────┐
│ worker 1 │  │ worker 2 │  │ worker 3 │
│ (cpu)    │  │ (cpu)    │  │ (cpu)    │
└──────────┘  └──────────┘  └──────────┘
```

---

## How it Works

1. A request arrives at the Node.js process.
2. The event loop picks it up and initiates the required operation (I/O, computation).
3. If the operation is I/O-bound (file read, DB query, HTTP call), it is offloaded to the OS kernel via libuv's thread pool — the event loop remains free for other requests (concurrency).
4. When the I/O completes, a callback is queued in the event loop's task queue.
5. The event loop dequeues the callback and resumes the request handler (concurrent completion).
6. If the operation is CPU-bound (hashing, image processing, JSON parse on large data), it blocks the event loop if run inline.
7. CPU-bound work is offloaded to a `Worker` thread, which runs on a separate core (true parallelism).
8. The worker sends the result back via message passing, and the event loop continues.

---

## Advantages

- **Efficient I/O** — async concurrency handles thousands of simultaneous connections with minimal overhead
- **Simpler mental model** — single-threaded event loop avoids data races and locking; however, logic-level races (async interleaving) can still occur (see [Race Conditions](nodejs-race-conditions.md))
- **Deterministic** — no thread-safety bugs for I/O-bound code
- **CPU scalability** — worker threads scale CPU work across cores when needed
- **Resource efficient** — lower memory per connection than thread-per-request models

---

## Trade-offs

- **Single-threaded bottleneck** — CPU-bound work blocks the event loop unless offloaded to workers
- **Worker overhead** — spawning worker threads has memory and startup cost
- **Coordination complexity** — passing messages between main thread and workers adds indirection
- **Not ideal for all CPU workloads** — heavy parallel computation may be better suited to C++ addons or dedicated services
- **Async cognitive load** — developers must understand promises, event loop phases, and backpressure

---

## When to Use

- **Concurrency** — always. Every Node.js server uses async I/O to handle multiple requests concurrently
- **Parallelism** — when you have CPU-bound work that would block the event loop: cryptography, image processing, large JSON parsing, data transformation
- Worker threads for background processing that cannot be offloaded to a message queue

---

## When NOT to Use

- Do not reach for worker threads for I/O-bound work — async I/O already handles it efficiently
- Do not assume parallel execution will speed up a single sequential task — Amdahl's Law applies
- Avoid worker threads for trivial CPU tasks — the overhead outweighs the benefit
- Do not use Node.js for heavy numerical computation — consider a dedicated service in a language better suited for it

---

## Worker Threads vs Child Processes

Node.js provides two APIs for running code outside the main thread: `worker_threads` and `child_process`. They serve different purposes.

| | Worker Threads (`worker_threads`) | Child Processes (`child_process`) |
|---|-----------------------------------|------------------------------------|
| **Memory** | Shares memory with the main process (via `SharedArrayBuffer`) | Separate memory space — no sharing |
| **Communication** | Message passing (structured clone); fast, low overhead | Message passing (serialized via IPC); pipe/stdio available |
| **Startup** | Lightweight — same V8 isolate, reuses loaded modules | Heavy — new V8 isolate, reloads all modules |
| **Use case** | CPU-bound computation (hashing, image processing, JSON parsing) | Running a separate program (Python script, shell command, legacy binary) |
| **Failure isolation** | Crash takes down the main process (same process) | Crash is isolated (separate process) |
| **Parallelism** | True parallelism (separate threads on separate cores) | True parallelism (separate processes on separate cores) |
| **API** | `new Worker('./worker.js')` | `spawn()`, `fork()`, `exec()`, `execFile()` |

**When to use Worker Threads:**

- CPU-bound computation within the same Node.js application — cryptography, image processing, template rendering, large JSON serialization/deserialization
- You need shared memory for performance-sensitive data passing
- You want low per-worker overhead and fast startup

**When to use Child Processes:**

- Running a non-Node.js program — Python, Ruby, shell scripts, ffmpeg
- You need strong failure isolation — a crash in the child must not affect the parent
- You need stdio pipe access — streaming data through stdin/stdout
- Forking for cluster mode (`cluster` module uses `child_process.fork` internally)

```typescript
// Worker thread — CPU-bound computation
import { Worker } from 'worker_threads';

const hashWorker = new Worker('./hash-worker.js', { workerData: input });
hashWorker.on('message', (result) => console.log(result));

// Child process — running a shell command
import { spawn } from 'child_process';
const ffmpeg = spawn('ffmpeg', ['-i', 'input.mp4', 'output.gif']);
ffmpeg.stdout.on('data', (data) => console.log(data.toString()));
```

---

## Related Concepts

- [Event Loop](event-loop.md)
- libuv
- Worker Threads
- Child Processes
- Async / Await
- Non-blocking I/O
- [Distributed Systems](distributed-systems.md) — each service in a distributed system handles concurrent requests, and parallelism scales work across machines

---

## Key Takeaways

> Concurrency (managing many tasks) is built into Node.js via the event loop and async I/O. Parallelism (executing many tasks simultaneously) requires worker threads or multiple processes. Understanding the difference prevents two common mistakes: blocking the event loop with CPU work, and over-engineering with threads when async I/O is sufficient.
