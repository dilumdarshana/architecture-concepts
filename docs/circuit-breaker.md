# Circuit Breaker

> A resilience pattern that detects failures in a downstream service and temporarily stops calling it, giving it time to recover and preventing cascading failures.

---

## What is it?

A **Circuit Breaker** wraps calls to an external service (HTTP API, database, message broker) and monitors for failures. When failures cross a threshold, the circuit **opens** — subsequent calls fail immediately without reaching the downstream service. After a timeout, the circuit transitions to **half-open**, allowing a probe request to test if the service has recovered.

The three states:

| State | Behavior | Transitions To |
|-------|----------|----------------|
| **Closed** | Calls pass through normally; failures are counted | Open (when threshold exceeded) |
| **Open** | Calls fail fast without invoking the downstream service; a timer starts | Half-Open (after timeout) |
| **Half-Open** | A limited number of probe calls are allowed through | Closed (success) or Open (failure) |

---

## Problem

In a [Distributed System](distributed-systems.md), services depend on other services. When one service degrades or fails:

- **Cascading failures** — every caller keeps retrying, amplifying load on the failing service and exhausting its own resources (threads, connections).
- **Resource exhaustion** — HTTP connections pool fills up waiting for timeouts; database connection pool depletes; the caller's own clients start timing out.
- **Slow recovery** — the failing service cannot recover because it is still receiving requests from every caller.
- **Wasted work** — the caller continues processing requests that are guaranteed to fail downstream.

A timeout alone is not enough — it prevents indefinite hangs but still allows repeated attempts that overload the downstream service and waste caller resources.

---

## Example

### Basic Circuit Breaker with opossum

The `opossum` library provides a standard circuit breaker for Node.js:

```typescript
import CircuitBreaker from 'opossum';
import axios from 'axios';

async function chargePayment(orderId: string, amount: number) {
  const response = await axios.post('https://payment.service/charge', {
    orderId,
    amount
  });
  return response.data;
}

const paymentBreaker = new CircuitBreaker(chargePayment, {
  timeout: 5000,                    // Max time per request
  errorThresholdPercentage: 50,     // Open when >50% of requests fail
  resetTimeout: 30000,              // Wait 30s before trying again
  rollingCountTimeout: 10000,       // Statistics window (10s)
  volumeThreshold: 5,               // Minimum requests before tripping
});

// Fallback when circuit is open
paymentBreaker.fallback(() => ({
  status: 'degraded',
  message: 'Payment service unavailable, retrying later'
}));

// Use the breaker
async function processPayment(orderId: string, amount: number) {
  try {
    const result = await paymentBreaker.fire(orderId, amount);
    return result;
  } catch (err) {
    // Circuit is open or all attempts failed
    await enqueueRetry(orderId);
    throw err;
  }
}
```

### Circuit Breaker with Health-Based Recovery

Instead of a fixed timeout, some implementations probe a health endpoint in the half-open state:

```typescript
const healthCheck = async () => {
  const response = await axios.get('https://payment.service/health');
  return response.status === 200;
};

const paymentBreaker = new CircuitBreaker(chargePayment, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

// Override the half-open probe behaviour
paymentBreaker.on('halfOpen', async () => {
  const healthy = await healthCheck();
  if (healthy) {
    paymentBreaker.close();
  }
});
```

### Manual Circuit Breaker (No Library)

For simple cases where adding a dependency is overkill:

```typescript
class SimpleCircuitBreaker {
  private failures = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;

  constructor(threshold = 5, resetTimeoutMs = 30000) {
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        if (fallback) return fallback();
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailureTime = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      if (fallback) return fallback();
      throw err;
    }
  }
}
```

---

## Architecture / Flow

```text
                    ┌──────────────────────────┐
                    │      Circuit Breaker      │
                    │                           │
  Request ─────────►│  State: CLOSED            │────────► Downstream
                    │  Count failures           │          Service
                    │  If threshold exceeded ───│────┐
                    │  open circuit             │    │
                    └──────────────────────────┘    │
                                                    ▼
                                             ┌──────────────┐
                                             │  State: OPEN  │
                                             │              │
  Request ─────────► Fail fast ──► fallback  │  Timer ticks  │
                    (no downstream call)     │  after 30s    │
                                             │  → HALF-OPEN  │
                                             └──────────────┘
                                                    │
                                             ┌──────┴──────┐
                                             ▼             ▼
                                       Probe OK     Probe fails
                                      ┌────────┐  ┌────────┐
                                      │ CLOSED │  │  OPEN  │
                                      │ (reset)│  │(retry) │
                                      └────────┘  │ timer  │
                                                  └────────┘
```

---

## How it Works

1. Circuit starts in the **Closed** state — all requests pass through to the downstream service.
2. The breaker tracks failures within a rolling time window (e.g. last 10 seconds).
3. When the failure rate exceeds `errorThresholdPercentage` (e.g. 50%) and `volumeThreshold` is met (e.g. 5 requests), the circuit **opens**.
4. In the **Open** state, all requests fail immediately without touching the downstream service. A configurable `resetTimeout` starts (e.g. 30 seconds).
5. After the timeout, the circuit transitions to **Half-Open** — a limited number of probe requests are allowed through.
6. If a probe request succeeds, the circuit **closes** — normal operation resumes and failure counters reset.
7. If a probe request fails, the circuit **opens** again and the reset timer restarts.

---

## Advantages

- **Fail fast** — clients get immediate errors instead of waiting for timeouts
- **Resource preservation** — no connections, threads, or CPU wasted on doomed requests
- **Cascading failure prevention** — a failing service's load is reduced, helping it recover
- **Self-healing** — automatic recovery via half-open probes requires no manual intervention
- **Observability** — state transitions provide clear signals for monitoring and alerting

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Increased latency during normal operation** — each call goes through the breaker's tracking logic | Negligible (in-memory counters) |
| **Tuning complexity** — threshold, timeout, and window parameters must be tuned per service | Wrong values cause unnecessary trips or insufficient protection |
| **Partial failures** — the breaker treats all failures equally; a 400 and a 500 have the same effect | Can mask application-level errors by opening the circuit for client errors |
| **Fallback logic** — every call needs a fallback or the client sees errors | Adds code complexity; fallbacks may themselves need protection |
| **Stale state** — in a half-open state, the first success closes the circuit; a single success may not indicate full recovery | Can lead to rapid open/close cycling if recovery is incomplete |

---

## When to Use

- Wrapping calls to external services over a network (HTTP, [gRPC](grpc.md)) where failures are expected
- Protecting services that have limited capacity or are prone to cascading failures
- Any synchronous dependency where a timeout is already configured — the breaker adds failure detection
- Multi-service architectures where one degraded service should not bring down the whole system

---

## When NOT to Use

- Local, in-process calls that cannot fail independently from the caller
- Asynchronous message passing via queues — the broker handles retries and backpressure
- Services that are the root of a request chain with no downstream dependencies
- Systems where all calls already use bulkhead patterns and resource isolation

---

## Related Concepts

- [Distributed Systems](distributed-systems.md) — circuit breakers are a fundamental resilience pattern in multi-service architectures
- [Idempotency](idempotency.md) — fallback paths and retries after circuit recovery must be idempotent
- [Cancellation & Timeouts](cancellation-timeouts.md) — timeouts are the prerequisite; circuit breakers add failure detection on top
- [Delivery Semantics](delivery-semantics.md) — breaker fallbacks often enqueue retries with at-least-once delivery
- [Error Handling (Express)](error-handling.md) — breaker failures should flow into the error middleware
- Retry Pattern
- Bulkhead Pattern
- Fallback Pattern

---

## Key Takeaways

> A Circuit Breaker wraps calls to a downstream service and opens when failures exceed a threshold, making subsequent calls fail fast. This prevents cascading failures, preserves caller resources, and gives the downstream service room to recover. The half-open state probes for recovery automatically. Always pair circuit breakers with timeouts, idempotent fallbacks, and monitoring on state transitions.
