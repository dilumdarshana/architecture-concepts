# Bulkhead Pattern

> Isolating system resources (connection pools, thread pools, queues) into separate partitions so that a failure in one does not cascade to others.

---

## What is it?

The Bulkhead Pattern takes its name from ship design — a ship's hull is divided into watertight compartments (bulkheads) so that a breach in one compartment does not sink the entire ship. In software, it isolates resources such as connection pools, thread pools, and queue consumers into separate partitions. If one partition is exhausted by a slow downstream dependency, the other partitions remain available.

---

## Problem

In a typical Node.js service, all requests share a single connection pool to the database and a single HTTP client pool to downstream services. If one downstream service becomes slow:

- All connections in the HTTP pool are held waiting for that service.
- The database connection pool is consumed by requests waiting for the HTTP pool.
- The event loop is occupied by these blocked operations.
- Requests to other, healthy endpoints are starved — the entire service degrades or crashes.

Without bulkheads, the failure of one dependency can bring down the whole service.

---

## Example

### Connection Pool Isolation

Instead of a single shared pool, create separate pools per dependency:

```typescript
import { Pool } from 'pg';

// Separate pools for different workloads
const inventoryPool = new Pool({
  connectionString: process.env.INVENTORY_DB_URL,
  max: 10,        // flash sale traffic isolated here
  idleTimeoutMillis: 30000,
});

const ordersPool = new Pool({
  connectionString: process.env.ORDERS_DB_URL,
  max: 30,        // normal traffic
  idleTimeoutMillis: 30000,
});

async function getInventory(productId: string) {
  const client = await inventoryPool.connect();
  try {
    const result = await client.query('SELECT stock FROM inventory WHERE id = $1', [productId]);
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function getOrders(customerId: string) {
  const client = await ordersPool.connect();
  try {
    const result = await client.query('SELECT * FROM orders WHERE customer_id = $1', [customerId]);
    return result.rows;
  } finally {
    client.release();
  }
}
```

### HTTP Client Bulkheads

Isolate outgoing HTTP connection pools per downstream service:

```typescript
import http from 'node:http';

interface BulkheadConfig {
  maxSockets: number;
  maxPending: number;
}

class BulkheadedAgent extends http.Agent {
  private pending = 0;
  private maxPending: number;

  constructor(config: BulkheadConfig) {
    super({ maxSockets: config.maxSockets });
    this.maxPending = config.maxPending;
  }

  addRequest(req: any, options: any) {
    if (this.pending >= this.maxPending) {
      req.destroy(new Error('Bulkhead limit reached'));
      return;
    }
    this.pending++;
    super.addRequest(req, options);
  }
}

// Each downstream service gets its own agent with separate limits
const paymentAgent = new BulkheadAgent({ maxSockets: 5, maxPending: 20 });
const inventoryAgent = new BulkheadAgent({ maxSockets: 10, maxPending: 50 });

// Slow payments do not consume inventory's sockets
async function chargeCustomer() {
  return fetch('https://payment.example.com/charge', { agent: paymentAgent });
}
```

### Queue Consumer Bulkheads

Separate worker queues per job type so one backlog does not block others:

```typescript
import { Queue, Worker } from 'bullmq';

// Each queue has its own concurrency limit
const emailQueue = new Queue('email', {
  defaultJobOptions: { attempts: 3 }
});
const reportQueue = new Queue('report', {
  defaultJobOptions: { attempts: 1 }
});

const emailWorker = new Worker('email', sendEmail, {
  concurrency: 5  // at most 5 concurrent email sends
});

const reportWorker = new Worker('report', generateReport, {
  concurrency: 1  // single report at a time (CPU-heavy)
});

// A backlog of 10,000 emails does not block report generation
```

---

## Architecture / Flow

```text
Without Bulkheads                    With Bulkheads
┌──────────────────┐               ┌──────────────────┐
│   Shared Pool    │               │  ┌────────────┐  │
│                  │               │  │ Payments   │  │
│  HTTP Clients ───┤               │  │ max: 5     │  │
│  DB Pool     ────┤               │  └────────────┘  │
│  Queue       ────┤  ← All        │  ┌────────────┐  │
│                  │    compete    │  │ Inventory  │  │
│                  │    for same   │  │ max: 10    │  │
│                  │    resources  │  └────────────┘  │
└──────────────────┘               │  ┌────────────┐  │
                                    │  │ Email      │  │
    One slow dependency             │  │ max: 5     │  │
    exhausts everything             │  └────────────┘  │
                                    └──────────────────┘
                                      Each dependency
                                      has its own limit
```

---

## How it Works

1. Identify each downstream dependency or workload type (database, payment API, inventory API, email queue).
2. For each dependency, allocate a dedicated resource pool (connection pool, HTTP agent, thread pool, queue consumer).
3. Configure each pool with its own limits — max connections, max pending requests, concurrency.
4. Route all traffic for a dependency through its dedicated pool.
5. If one dependency becomes slow or unavailable, only its pool's resources are exhausted.
6. Other dependencies continue operating normally because their pools are unaffected.
7. Monitor pool utilization to tune limits and detect when a bulkhead is approaching capacity.

---

## Advantages

- **Failure isolation** — one slow dependency cannot starve others
- **Predictable capacity** — each workload type has a guaranteed resource share
- **Graceful degradation** — only the affected functionality degrades; the rest of the system stays healthy
- **Clear signalling** — pool exhaustion surfaces as immediate errors (instead of subtle timeouts)
- **Simpler debugging** — a pool reaching its limit points directly to the problematic dependency

---

## Trade-offs

- **Resource underutilisation** — dedicated pools may sit idle while others are starving; requires careful capacity planning
- **Configuration overhead** — each dependency needs a separate pool with tuned limits
- **Hard to get limits right** — too low causes false positives, too high defeats the purpose
- **Operational complexity** — monitoring more pools, agents, and queues
- **Not a replacement for Circuit Breaker** — bulkhead prevents resource exhaustion; circuit breaker stops calling an unhealthy service (they complement each other)

---

## When to Use

- **Multi-dependency services** — any service that calls multiple downstream APIs or databases
- **Mixed workloads** — I/O-heavy and CPU-heavy operations in the same service (separate worker pools)
- **Multi-tenant systems** — isolate one tenant's resource usage from another's
- **Services with connection-pooled resources** — databases, message queues, HTTP clients
- **Queue-based architectures** — separate queues per job type prevents one flood from delaying others

---

## When NOT to Use

- **Simple services with one dependency** — bulkhead adds complexity for no benefit
- **Stateless request-reply services** — there are no long-held resources to partition
- **When pooling is already handled** — some managed services (RDS proxy, Envoy sidecar) provide connection pooling per destination
- **Before measuring** — do not add bulkheads speculatively; measure actual pool contention first

---

## Related Concepts

- [Circuit Breaker](circuit-breaker.md) — bulkhead prevents resource exhaustion; circuit breaker stops calls to unhealthy services (best used together)
- [Backpressure](backpressure.md) — bulkhead limits the incoming pressure each dependency can exert
- [Rate Limiting](rate-limiting.md) — rate limiting protects the system from aggressive clients; bulkhead protects it from slow dependencies
- [Graceful Shutdown](graceful-shutdown.md) — bulkhead pools should be drained and closed during shutdown
- [Retry Pattern](retry-pattern.md) — retries should respect bulkhead pool limits
- [Distributed Systems](distributed-systems.md) — bulkhead is a resilience pattern for multi-service architectures

---

## Key Takeaways

> The Bulkhead Pattern isolates resources (connection pools, HTTP clients, queues) per dependency so that a slow or failing dependency cannot exhaust the shared pool and bring down the entire service. It is part of a comprehensive resilience strategy alongside Circuit Breaker, Rate Limiting, and Retry. Each dependency gets its own pool with dedicated limits — measured and tuned based on real traffic patterns. Bulkhead prevents cascading failures by ensuring that every dependency has a guaranteed resource budget.
