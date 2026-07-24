# Connection Pooling

> Managing a cache of reusable database or HTTP connections to reduce latency, control resource usage, and prevent exhaustion.

---

## What is it?

Connection pooling maintains a bounded set of established connections (database sockets, HTTP sockets) that are borrowed, used, and returned rather than created and destroyed per request. The pool manages the lifecycle — creation, idle timeout, queueing, and health checks — so the application never opens a connection in a hot path.

---

## Problem

Opening a connection is expensive:

- **Database connections** — TCP handshake, TLS negotiation, authentication, session state setup. A single `pg.Client.connect()` can take 10-50ms.
- **HTTP connections** — TCP handshake, TLS, potentially HTTP/2 session negotiation. Without `keepAlive`, every request does this from scratch.

Without pooling:

```
Request A ──► open connection ──► query ──► close (10ms setup)
Request B ──► open connection ──► query ──► close (10ms setup)
Request C ──► open connection ──► query ──► close (10ms setup)
```

With pooling:

```
         ┌─── idle conn 1
Pool ────┼─── idle conn 2    Request A borrows conn 1, returns it
         └─── idle conn 3    Request B borrows conn 2, returns it
```

Each request saves the setup cost. Additionally, a pool bounds the maximum number of concurrent connections, preventing the application from exhausting database server limits or file descriptors.

---

## Example

### Database Connection Pool (pg)

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // max 20 concurrent connections
  min: 4,                     // keep 4 idle connections warm
  idleTimeoutMillis: 30_000,  // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail if acquire takes >5s
});

async function getUser(id: string) {
  const client = await pool.connect(); // borrow from pool
  try {
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  } finally {
    client.release(); // return to pool
  }
}

// Pool events
pool.on('error', (err) => console.error('Connection error:', err));
pool.on('acquire', () => console.log('Client acquired'));
pool.on('remove', () => console.log('Client removed'));
```

### HTTP Connection Pool (http.Agent)

Node.js `http.Agent` reuses TCP sockets via `keepAlive`:

```typescript
import http from 'node:http';
import https from 'node:https';

// Default global agent — shared across all requests
const dbPool = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,      // send keep-alive every 1s on idle sockets
  maxSockets: 25,            // max 25 concurrent sockets per origin
  maxFreeSockets: 10,        // keep 10 idle sockets
  scheduling: 'lifo',        // 'lifo' (reuse recent) or 'fifo' (fair)
});

// Per-service agents for isolation (Bulkhead pattern)
const paymentAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: 5_000,
});

const inventoryAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,
  timeout: 3_000,
});

// Fetch with a specific agent
async function chargeCustomer() {
  const response = await fetch('https://payments.example.com/charge', {
    agent: paymentAgent,
    signal: AbortSignal.timeout(10_000),
  });
  return response.json();
}
```

---

## Architecture / Flow

```
Application                  Connection Pool                 Server (DB / HTTP)
     │                            │                                │
     │  pool.connect()            │                                │
     │ ─────────────────────────►│                                │
     │                           │  ┌─── idle conn 1              │
     │                           │  ├─── idle conn 2              │
     │                           │  └─── idle conn 3              │
     │                           │                                │
     │                           │  Borrow idle conn 2            │
     │                           │ ────────────────────────►      │
     │  client acquired          │                                │
     │ ◄─────────────────────────│                                │
     │                           │                                │
     │  client.query(...)        │                                │
     │ ───────────────────────────────────────────────────────►   │
     │                           │                                │
     │  client.release()         │                                │
     │ ─────────────────────────►│                                │
     │                           │  Return conn 2 to idle pool    │
     │                           │                                │
     │                           │  If pool is full, close conn   │
     │                           │  If idle > idleTimeoutMillis,  │
     │                           │  close conn                    │
```

**When all connections are busy:**

```
     │  pool.connect()            │                                │
     │ ─────────────────────────►│                                │
     │                           │  No idle connections            │
     │                           │  Queue the request              │
     │                           │                                │
     │      ... waits for a connection to be released ...          │
     │                           │                                │
     │  (other client releases)  │                                │
     │                           │  Dequeue + assign               │
     │  client acquired          │                                │
     │ ◄─────────────────────────│                                │
```

---

## How it Works

1. On startup, the pool creates `min` idle connections and holds them in a free list.
2. When the application calls `connect()` / `acquire()`, the pool returns an idle connection from the free list.
3. If no idle connections are available and the pool is below `max`, a new connection is created.
4. If no idle connections are available and the pool is at `max`, the request is queued until a connection is released or `connectionTimeoutMillis` expires.
5. When the application releases the connection, it returns to the free list. If the pool has more idle connections than `maxFreeSockets` (HTTP) or idle connections exceed `idleTimeoutMillis`, the connection is closed instead.
6. If a connection emits an error, it is destroyed and removed from the pool — a replacement is created lazily.
7. On shutdown, the pool drains: it stops accepting new acquire requests, waits for in-flight connections to be released, then closes all connections.

---

## Pool Sizing Heuristics

### Database Pool

The classic formula for a single service instance:

```
pool max = (cpu_cores * 2) + effective_spindle_count
```

Where `effective_spindle_count` is the number of physical disks (usually 1 for SSDs). For a 4-core machine:

```
pool max = (4 * 2) + 1 = 9
```

This assumes queries are fast (single-digit milliseconds). If queries are slow (hundreds of milliseconds), reduce `max` — concurrent slow queries amplify contention. If the database has its own connection limit (e.g., Postgres `max_connections = 100`), divide by the number of service instances:

```
per_instance_max = (db_max_connections - reserved) / instances
```

### HTTP Pool

Size based on concurrency and latency:

```
maxSockets = concurrent_request_rate * p99_latency_seconds
```

For a service handling 50 req/s with a p99 upstream latency of 2s:

```
maxSockets = 50 * 2 = 100
```

In practice, start with `maxSockets: 25` and monitor `requests` (queue depth) on the agent — if requests are queued, increase; if sockets sit idle, decrease.

### Pool Sizing Quick Reference

| Metric | DB Pool | HTTP Pool |
|--------|---------|-----------|
| Lower bound | `min=2` (warm standby) | `keepAlive=true`, `maxFreeSockets=5` |
| Upper bound | `max=20` per 4-core instance | `maxSockets=25` per upstream |
| Saturation signal | `waitingCount > 0` | `agent.requests` queue grows |
| Common mistake | Setting `max=100` because it works locally | Not setting `keepAlive` |

---

## Monitoring Pools

```typescript
// pg Pool — inspect state
console.log({
  totalCount: pool.totalCount,       // all connections (idle + active)
  idleCount: pool.idleCount,         // connections waiting to be used
  waitingCount: pool.waitingCount,   // requests queued for a connection
});

// http.Agent — inspect state
const agent = new http.Agent({ keepAlive: true });
// Accessing internal state for monitoring
console.log({
  sockets: Object.keys(agent.sockets),       // active sockets per origin
  freeSockets: Object.keys(agent.freeSockets), // idle sockets per origin
  requests: Object.keys(agent.requests),     // queued requests per origin
});
```

### What to Alert On

- `waitingCount > 0` — requests are queueing, pool may be undersized or a connection leak exists.
- `idleCount === 0` and `totalCount === max` — pool is fully utilised, consider scaling up.
- `connectionTimeoutMillis` errors — connections are timing out, check database/upstream health.

---

## Connection Pool Exhaustion

Exhaustion occurs when all connections are in use and the queue is full:

**Symptoms:**
- `pg` throws `Error: Connection pool timeout` or `Error: Queue limit exceeded`
- HTTP requests hang or time out waiting for a socket
- P95 latency spikes
- Downstream begins returning 503/504

**Causes:**
- **Connection leak** — code acquires a connection but never releases it (missing `finally` block)
- **Slow queries** — connections are held longer than expected, reducing effective pool capacity
- **Traffic spike** — more concurrent requests than the pool was sized for
- **Unhealthy upstream** — connections are held open waiting for a response that never comes

**Mitigations:**

```typescript
// 1. Always release in finally
const client = await pool.connect();
try {
  await client.query('...');
} finally {
  client.release(); // guaranteed release even on error
}

// 2. Set a query timeout so slow queries release connections
await client.query({ text: '...', timeout: 10_000 });

// 3. Use Circuit Breaker to stop calling unhealthy upstreams
// 4. Use Bulkhead to isolate pools per dependency
// 5. Alert on pool metrics before exhaustion occurs
```

---

## Advantages

- **Latency reduction** — reuses established connections, skips TCP+TLS handshake per request
- **Resource control** — bounds the maximum load the application places on the database or upstream
- **Graceful degradation** — queuing with timeout fails fast instead of hanging indefinitely
- **Connection health** — pools detect and evict dead connections, replacing them with fresh ones
- **Centralised lifecycle** — one place to configure timeouts, limits, and retry logic

---

## Trade-offs

- **Queueing latency** — if all connections are busy, new requests wait in a queue before acquiring
- **Stale connections** — long-idle connections may be closed by firewalls or database timeouts (mitigated by `keepAlive` and `idleTimeoutMillis`)
- **Connection skew** — in multi-instance deployments, one instance may exhaust its pool while others have capacity (use a proxy for centralised pooling)
- **Memory overhead** — each connection consumes RAM on both application and server sides
- **Debugging complexity** — connection leaks are hard to reproduce and diagnose in production

---

## When to Use

- **Every database-backed application** — always use a pool instead of creating connections per request
- **Services that call HTTP APIs** — use `keepAlive: true` on `http.Agent` to reuse sockets
- **Serverless (AWS Lambda)** — use a pool with `max: 1` and warm connections across invocations when the runtime environment is reused
- **High-throughput systems** — where connection setup overhead measurably impacts latency or CPU

---

## When NOT to Use

- **Short-lived scripts / CLIs** — a one-off query does not benefit from pooling
- **Single-user tools** — no concurrency to benefit from connection reuse
- **Connectionless protocols** — UDP, gRPC (uses its own multiplexed connections)
- **When a proxy handles pooling** — RDS Proxy, PgBouncer, or Envoy sidecar manage connection pooling at the infrastructure layer; the application pool may be redundant

---

## Related Concepts

- [Bulkhead Pattern](bulkhead-pattern.md) — isolates connection pools per dependency so one slow service cannot starve others
- [Circuit Breaker](circuit-breaker.md) — stops calling an unhealthy upstream, preventing connection pool exhaustion from hung requests
- [Backpressure](backpressure.md) — when the pool is full, queuing with timeout applies backpressure to the caller
- [Graceful Shutdown](graceful-shutdown.md) — drain and close all connection pools before exiting
- [Cancellation & Timeouts](cancellation-timeouts.md) — AbortSignal timeout prevents queries from holding connections indefinitely
- [Database Concurrency Control](database-concurrency-control.md) — connection pool limits interact with database-level concurrency limits
- [MySQL Scaling](mysql-scaling.md) — connection pooling with ProxySQL for managing many application instances

---

## Key Takeaways

> Always use a connection pool — never open a connection per request. Size the pool based on CPU cores (DB) or request rate * latency (HTTP). Always release connections in a `finally` block to prevent leaks. Monitor `waitingCount` (DB) and `agent.requests` (HTTP) as early warning signals for pool exhaustion. Use pools with `keepAlive` to avoid TCP+TLS handshake overhead on every request. A pool is a bounded resource — pair it with Bulkhead for isolation and Circuit Breaker to stop calling unhealthy upstreams that would consume pool capacity.
