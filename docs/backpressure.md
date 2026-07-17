# Backpressure

> A flow control mechanism that regulates the rate at which data is sent through a system to prevent a fast producer from overwhelming a slow consumer.

---

## What is it?

Backpressure is the propagation of capacity constraints upstream through a system. When a consumer cannot keep up with the producer's rate, it signals the producer to slow down or stop. This prevents unbounded memory growth, request queueing, and eventual system collapse. Backpressure can be applied at multiple levels: TCP flow control, HTTP/2 stream control, message queue consumer credits, and application-level circuit breakers.

---

## Problem

In a data pipeline, message queue consumer, or HTTP server, the producer may send data faster than the consumer can process it. Without backpressure:

- **Unbounded queues** — in-memory queues grow until the process runs out of memory.
- **Latency spikes** — requests spend increasing time waiting in the queue.
- **Resource exhaustion** — CPU, memory, and connection pools are consumed by accumulating backlog.
- **Cascading failure** — a slow consumer causes the producer to fail, which causes its caller to fail, and so on upstream.

Backpressure addresses the root cause: the producer must not outpace the consumer.

---

## Example

### Node.js Streams — Built-in Backpressure

Node.js streams implement backpressure via `highWaterMark` and the `drain` event:

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { Transform } from 'stream';

const readStream = createReadStream('./large-file.csv', { highWaterMark: 16 * 1024 });
const writeStream = createWriteStream('./output.csv');

const transform = new Transform({
  transform(chunk, encoding, callback) {
    // Process chunk
    const processed = chunk.toString().toUpperCase();
    // Returns false if internal buffer exceeds highWaterMark
    const canContinue = this.push(processed);
    callback();
  }
});

// Backpressure-aware piping
readStream
  .pipe(transform)
  .pipe(writeStream)
  .on('error', (err) => console.error('Stream failed:', err));

// Or manually handle backpressure
readStream.on('data', (chunk) => {
  const canContinue = writeStream.write(chunk);
  if (!canContinue) {
    readStream.pause();            // stop reading
    writeStream.once('drain', () => {
      readStream.resume();         // resume when consumer is ready
    });
  }
});
```

### HTTP Backpressure with AbortController

When a client disconnects, the server should stop processing:

```typescript
import { createServer } from 'http';
import { setTimeout } from 'timers/promises';

const server = createServer(async (req, res) => {
  const signal = AbortSignal.timeout(10_000); // timeout

  req.on('close', () => {
    // Client disconnected — stop processing
    signal.dispatchEvent(new Event('abort'));
  });

  try {
    const data = await fetch('http://slow-downstream/api', { signal });
    const result = await data.json();
    res.end(JSON.stringify(result));
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 503;
      res.end('Service Unavailable');
    }
  }
});

server.listen(3000);
```

### Message Queue Backpressure (BullMQ)

Control how many jobs a worker picks up at once:

```typescript
import { Worker, Queue } from 'bullmq';

const queue = new Queue('payments', {
  defaultJobOptions: {
    // Limit: at most 100 unacknowledged jobs per worker
    backoff: { type: 'exponential', delay: 1000 }
  }
});

const worker = new Worker('payments', async (job) => {
  // process the job
  await chargeCustomer(job.data);
}, {
  concurrency: 10,           // max 10 concurrent jobs per worker
  limiter: {
    max: 100,                // max 100 jobs per duration
    duration: 1000           // per 1 second
  }
});

// When the queue builds up, backpressure signals the producer
async function producer() {
  const queueSize = await queue.getWaitingCount();
  if (queueSize > 1000) {
    // Backpressure — stop producing until queue drains
    await queue.waitUntilReady();
    return;
  }
  await queue.add('charge', { orderId: '123' });
}
```

---

## Architecture / Flow

```text
No Backpressure:
  Producer ──► Queue (unbounded) ──► Consumer (slow)
                  │
                  ▼
             Runs out of memory
             Process crashes

With Backpressure:
  Producer ──► Queue (bounded) ──► Consumer (slow)
                  │
                  │  "I'm full!"
                  ▼
  Producer pauses ──► wait for drain ──► resume
```

### Backpressure in a Distributed System

```text
Client ──► Service A ──► Queue ──► Service B ──► Database

 1. Database is slow → B's connection pool fills up
 2. B stops consuming from the queue (backpressure)
 3. Queue grows → Queue size limit reached
 4. Queue rejects new messages → A's publish fails
 5. A returns 503 to the client

Backpressure propagates upstream until the source is throttled.
```

---

## How it Works

1. The consumer has a finite capacity: max concurrent requests, max queue size, max memory for buffering.
2. When the consumer's capacity is reached, it stops accepting new work.
3. The producer detects that the consumer is unavailable or the intermediate queue is full.
4. The producer pauses its own processing and may buffer, drop, or reject new work.
5. When the consumer drains its backlog and signals readiness, the producer resumes.
6. In stream-based systems (Node.js streams, TCP), the `drain` event signals readiness.
7. In queue-based systems, the queue's capacity limit or consumer credits propagate pressure upstream.
8. In HTTP systems, the caller receives a 429 (Too Many Requests) or 503 (Service Unavailable) and may retry with backoff.

---

## Advantages

- **Stability** — prevents unbounded memory growth and resource exhaustion
- **Graceful degradation** — the system slows down instead of crashing
- **Cascade prevention** — propagates pressure upstream so the source can throttle at the entry point
- **Predictable resource usage** — bounded queues and pools ensure the system operates within known limits
- **Stream efficiency** — Node.js streams with backpressure process large datasets with constant memory

---

## Trade-offs

- **Complexity** — manual backpressure handling (streams, queues) adds code and testing surface
- **Latency** — pausing the producer may increase end-to-end latency
- **Throttling the source** — if the source is a user-facing API, returning 503 provides poor UX (mitigate with queuing and status polling)
- **Deadlock risk** — poorly implemented backpressure can cause a system-wide stall if pressure propagates incorrectly
- **No backpressure in HTTP/1.1** — servers cannot signal the client to slow down; they must drop or buffer

---

## When to Use

- **Data pipelines** — ETL, log ingestion, image processing, where producer rate exceeds consumer throughput
- **Stream processing** — reading/writing large files, network streams, compression
- **Message queue consumers** — prevent workers from accepting more work than they can handle
- **Proxy services** — when the downstream cannot keep up, the proxy should apply backpressure to its caller
- **Any bounded resource** — connection pools, thread pools, memory buffers

---

## When NOT to Use

- **Fire-and-forget tasks** — if the producer does not need a response and data loss is acceptable
- **Low-volume systems** — the complexity is not justified when the producer rarely exceeds consumer capacity
- **Systems that prefer dropping over slowing** — if dropping excess data is acceptable (e.g. metrics, sampling), backpressure is unnecessary

---

## Related Concepts

- [Rate Limiting](rate-limiting.md) — rate limiting protects the system at the entry point; backpressure propagates capacity constraints from within
- [Bulkhead Pattern](bulkhead-pattern.md) — bulkheads isolate capacity per dependency so one consumer's backpressure does not affect others
- [Circuit Breaker](circuit-breaker.md) — circuit breaker stops calls when a downstream is unhealthy; backpressure causes the upstream to slow down
- [Cancellation & Timeouts](cancellation-timeouts.md) — timeouts bound how long a producer waits for capacity; cancellation releases resources
- [Graceful Shutdown](graceful-shutdown.md) — shutdown should drain in-flight work while respecting backpressure signals
- [Event Loop](event-loop.md) — Node.js streams use the event loop to manage backpressure via `drain` events
- TCP Flow Control
- HTTP/2 Flow Control

---

## Key Takeaways

> Backpressure regulates the flow between a fast producer and a slow consumer to prevent unbounded resource usage. It propagates capacity constraints upstream until the source is throttled. Node.js streams handle backpressure natively via `highWaterMark` and the `drain` event. In distributed systems, bounded queues, consumer credits, and rate limiters implement backpressure across service boundaries. Backpressure is a fundamental resilience mechanism — without it, a slow consumer can cause the entire system to run out of memory and crash.
