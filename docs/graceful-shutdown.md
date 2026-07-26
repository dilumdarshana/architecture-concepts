# Graceful Shutdown

> Handling OS signals (SIGINT, SIGTERM) to drain active work, close connections, and clean up resources before the process exits.

---

## What is it?

**Graceful shutdown** is the process of intercepting termination signals, stopping the acceptance of new work, letting in-flight work complete, closing database connections and message queue consumers, and then exiting cleanly. Without it, processes are killed mid-operation — leaving open connections, unacknowledged messages, and partial writes.

The key OS signals:

| Signal | Typical Trigger | Default Behavior |
|--------|----------------|------------------|
| `SIGINT` | Ctrl+C in terminal | Immediate termination |
| `SIGTERM` | `kill`, orchestrator (Kubernetes, ECS) | Immediate termination |
| `SIGHUP` | Terminal closed, config reload | Restart or termination |

---

## Problem

When a process is terminated abruptly:

- **Database** — active transactions are rolled back; connection pool entries leak, exhausting connections.
- **Message queues** — in-flight messages are not acknowledged; they reappear in the queue only after a visibility timeout (wasted processing).
- **HTTP servers** — open connections are dropped mid-response; clients receive `ECONNRESET` without knowing if the request was processed.
- **File I/O** — buffered writes are lost.
- **Worker threads** — background jobs are abandoned without completion tracking.

In containerized environments (Docker, Kubernetes), pods are terminated regularly during deployments, scaling, and rolling updates. Without graceful shutdown, every deployment causes dropped requests and failed jobs.

---

## Example

### Basic Express + Prisma + BullMQ Shutdown

```typescript
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { createServer } from 'http';

const app = express();
const prisma = new PrismaClient();
let server: ReturnType<typeof createServer>;

// BullMQ worker — processes order confirmation jobs
const worker = new Worker('orders', async (job) => {
  await prisma.order.update({
    where: { id: job.data.orderId },
    data: { status: 'confirmed' }
  });
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, starting graceful shutdown...`);

  // 1. Stop accepting new HTTP requests
  server.close(() => {
    console.log('HTTP server closed');
  });

  // 2. Stop pulling new jobs from the queue
  await worker.close(true); // `true` = wait for active jobs to finish
  console.log('BullMQ worker drained and closed');

  // 3. Close database connections
  await prisma.$disconnect();
  console.log('Database connections closed');

  // 4. Exit
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server = app.listen(3000, () => {
  console.log('Server listening on port 3000');
});
```

### Kubernetes-Ready Shutdown with Timeout

Kubernetes sends `SIGTERM` and waits for a configurable `terminationGracePeriodSeconds` (default 30s) before sending `SIGKILL`. The shutdown must complete within that window.

```typescript
async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);

  // Enforce a hard timeout — if shutdown takes too long, force exit
  const forceExit = setTimeout(() => {
    console.error('Forced exit after timeout');
    process.exit(1);
  }, 25_000); // Must be < Kubernetes terminationGracePeriodSeconds

  try {
    // Stop load balancer from routing new traffic
    server.close();

    // Drain all active workers
    await Promise.all([
      orderWorker.close(true),
      notificationWorker.close(true),
      emailWorker.close(true),
    ]);

    // Close all database and Redis connections
    await Promise.all([
      prisma.$disconnect(),
      redis.quit(),
    ]);

    clearTimeout(forceExit);
    console.log('Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
}
```

### Tracking In-Flight Requests and Draining Keep-Alive Sockets

`server.close()` stops accepting new connections but does **not** close existing keep-alive connections. Active requests on those keep-alive sockets must complete before the server can fully drain. Use a tracking set to know when all requests finish:

```typescript
import { createServer, Socket } from 'http';
import express from 'express';

const app = express();
const server = createServer(app);

const inFlight = new Set<Socket>();
const idleSockets = new Set<Socket>();

// Track every connection
server.on('connection', (socket) => {
  idleSockets.add(socket);

  socket.on('close', () => {
    idleSockets.delete(socket);
    inFlight.delete(socket);
  });
});

// Track in-flight requests
app.use((req, res, next) => {
  inFlight.add(req.socket);
  res.on('finish', () => {
    inFlight.delete(req.socket);
    idleSockets.add(req.socket);
  });
  next();
});

async function shutdown() {
  isShuttingDown = true;

  // 1. Stop new connections and close idle keep-alive sockets
  server.close(() => {
    console.log('All connections closed');
  });

  // Node 19+ — close idle keep-alive sockets immediately
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  } else {
    // Manual: destroy idle keep-alive sockets
    for (const socket of idleSockets) {
      socket.destroy();
    }
    idleSockets.clear();
  }

  // 2. Wait for in-flight requests with a timeout
  const drainTimeout = setTimeout(() => {
    console.warn('Forcing remaining connections to close');
    for (const socket of inFlight) {
      socket.destroy();
    }
  }, 10_000);

  // Poll until all in-flight requests complete
  while (inFlight.size > 0) {
    await sleep(100);
  }

  clearTimeout(drainTimeout);
  console.log('All in-flight requests completed');

  // 3. Drain workers, close DB, etc.
  await Promise.all([worker.close(true), prisma.$disconnect()]);
  process.exit(0);
}
```

### Health Check Endpoint for Orchestrators

Kubernetes uses readiness probes to know when to stop sending traffic. The server can reject new requests during shutdown:

```typescript
let isShuttingDown = false;

app.get('/health', (req, res) => {
  if (isShuttingDown) {
    res.status(503).json({ status: 'shutting down' });
    return;
  }
  res.json({ status: 'healthy' });
});

async function shutdown(signal: string) {
  isShuttingDown = true;
  // Return 503 from health checks — orchestrator stops routing traffic
  await sleep(2000); // Allow load balancer to detect unhealthy
  server.close();
  // ... drain workers, close connections
}
```

---

## Architecture / Flow

```text
Normal Operation:
┌─────────────────────────────────────────┐
│              Node.js Process             │
│                                          │
│  HTTP Server ──► accepts new requests    │
│  BullMQ Worker ──► pulls and processes   │
│  Prisma ──► maintains connection pool    │
│  Redis ──► maintains connection          │
└─────────────────────────────────────────┘

Shutdown Sequence:
┌─────────────────────────────────────────┐
│  1. OS sends SIGINT/SIGTERM              │
│  2. Handler sets isShuttingDown = true   │
│  3. Readiness probe returns 503          │
│  4. server.close() — stops new conns     │
│  5. closeIdleConnections() — destroy     │
│     idle keep-alive sockets              │
│  6. Poll until inFlight Set is empty     │
│     (with timeout + force destroy)       │
│  7. worker.close(true) — drains active   │
│  8. prisma.$disconnect() — closes pool   │
│  9. redis.quit() — closes connection     │
│ 10. process.exit(0)                      │
└─────────────────────────────────────────┘
```

---

## How it Works

1. Process registers signal handlers for `SIGINT` and `SIGTERM`.
2. Signal arrives — the handler sets a shutdown flag and begins draining.
3. Readiness probe returns 503 — the orchestrator stops routing new traffic.
4. **HTTP server**: `server.close()` stops accepting new connections. Keep-alive sockets that are idle are destroyed via `server.closeIdleConnections()` (Node 19+) or manually tracked and destroyed.
5. In-flight requests are tracked via a `Set<Socket>`. The shutdown polls until the set is empty or a timeout fires, forcefully destroying remaining sockets.
6. **BullMQ workers**: `worker.close(true)` signals the worker to stop pulling new jobs. If `true` (graceful), it waits for currently active jobs to finish before resolving.
7. **Database pool**: `$disconnect()` on Prisma closes all connections in the pool after pending queries finish.
8. **Redis/Message brokers**: `client.quit()` sends `QUIT`, waits for ongoing commands to finish, then closes.
9. A forced timeout (slightly less than the orchestrator's `terminationGracePeriodSeconds`) ensures the process exits even if cleanup hangs.
10. `process.exit(0)` with a clean exit code signals a successful shutdown.

---

## Advantages

- **Zero-downtime deployments** — orchestrators can roll pods without dropping requests
- **No orphaned work** — in-flight messages are acknowledged, DB transactions complete, jobs are not re-processed unnecessarily
- **Clean state** — connections are properly closed; no resource leaks or half-written state
- **Consumer trust** — external clients do not see `ECONNRESET` or incomplete responses

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Timeout management** — shutdown must complete within the orchestrator's grace period | Forces trade-off between draining everything and exiting on time |
| **Complexity** — each resource (HTTP, queue, DB, Redis) has its own drain mechanism | Requires careful orchestration and error handling |
| **Blocking shutdown** — if a worker job hangs, shutdown stalls | Must use `Promise.race` with a timeout or force exit |
| **State coordination** — in a [Distributed System](distributed-systems.md), one service shutting down affects others | Downstream services must handle connection errors with retries |

---

## When to Use

- Every long-running Node.js process — HTTP servers, queue workers, batch processors
- Containerized deployments (Kubernetes, ECS, Nomad) that manage pod lifecycle with signals
- Systems with message queues where unacknowledged messages cause processing delays
- Services that hold database connections or other long-lived resources

---

## When NOT to Use

- Short-lived scripts or CLI tools that run and exit immediately
- Processes that do not hold any connections or in-flight work
- Serverless functions (AWS Lambda, Cloud Functions) — the runtime manages lifecycle

---

## Related Concepts

- [Promise APIs](promise-apis.md) — `Promise.all` coordinates parallel cleanup; `Promise.race` enforces timeouts
- [Delivery Semantics](delivery-semantics.md) — graceful shutdown prevents unacknowledged messages from being lost or delayed
- [Cancellation & Timeouts](cancellation-timeouts.md) — abort in-flight work during shutdown instead of waiting
- [Error Handling (Express)](error-handling.md) — errors during shutdown must not propagate to middleware
- [Distributed Systems](distributed-systems.md) — coordinated shutdown across multiple services during deployments
- Kubernetes Pod Lifecycle
- OS Signals
- [Event Loop](event-loop.md)
- [Outbox + Idempotency + Retry Demo](../outbox-idempotency-retry) — Express + Prisma + BullMQ implementation with SIGINT/SIGTERM graceful shutdown

---

## Key Takeaways

> Graceful shutdown intercepts SIGINT/SIGTERM to drain active work, close connections, and exit cleanly. In containerized deployments, the shut-down must complete within the orchestrator's grace period — use timeouts to force exit if cleanup stalls. Every Express/Fastify server, BullMQ worker, and Prisma client should implement a signal handler to avoid dropped requests and orphaned work.
