# Rate Limiting

> Controlling the rate of requests a client, user, or service can make within a given time window.

---

## What is it?

Rate limiting restricts how many requests a client can issue in a specific time period. It protects backend services from overload, prevents abuse, and ensures fair resource allocation across clients. Common algorithms include **token bucket**, **leaky bucket**, **fixed window**, and **sliding window log**.

---

## Problem

Without rate limiting, a single aggressive client can saturate resources and degrade the experience for all other clients:

- A buggy client sends requests in an infinite loop.
- A malicious actor launches a denial-of-service (DoS) attack.
- A flash crowd of legitimate users overwhelms the server.
- An expensive endpoint (report generation, bulk export) is called too frequently.

Rate limiting declines excessive requests with a `429 Too Many Requests` status, protecting the system while giving the client clear feedback on when to retry.

---

## Example

### Token Bucket (Most Common)

A bucket holds `capacity` tokens. Each request consumes one token. Tokens refill at `rate` per second.

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// Usage: 10 requests per second, burst up to 20
const bucket = new TokenBucket(20, 10);

app.use((req, res, next) => {
  if (bucket.tryConsume()) {
    next();
  } else {
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: Math.ceil(60 / 10) // seconds until next token
    });
  }
});
```

### Distributed Rate Limiting with Redis

For multi-instance deployments, rate limit state must be shared:

```typescript
import { createClient } from 'redis';

const redis = createClient();

async function checkRateLimit(
  userId: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  // Remove old entries outside the window
  await redis.zRemRangeByScore(key, 0, windowStart);
  // Count requests in current window
  const count = await redis.zCard(key);

  if (count >= maxRequests) {
    return false; // rate limited
  }

  // Add this request
  await redis.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
  await redis.expire(key, Math.ceil(windowMs / 1000));
  return true;
}

// Express middleware
app.use(async (req, res, next) => {
  const userId = req.ip;
  const allowed = await checkRateLimit(userId, 100, 60_000); // 100 req/min
  if (!allowed) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
});
```

---

## Architecture / Flow

### Algorithms Comparison

| Algorithm | How it Works | Pros | Cons |
|-----------|-------------|------|------|
| **Token Bucket** | Tokens refill at a steady rate; burst up to capacity | Handles bursts naturally; smooth rate | Needs state per client |
| **Leaky Bucket** | Requests drip out at a fixed rate; excess spills | Consistent output rate | Rejects bursts aggressively |
| **Fixed Window** | Count requests per clock-aligned window (e.g. per minute) | Simple; stateless per window | Burst at window boundary (2x traffic at reset) |
| **Sliding Window Log** | Timestamped logs within a rolling window | Precise; no boundary burst | More memory and computation |
| **Sliding Window Counter** | Approximate count from current + previous window | Good precision; efficient | Approximation has small error |

```text
Token Bucket
         ▲
    cap  │  ▒▒▒▒▒▒▒▒▒▒                         ← full bucket
         │  ▒▒▒▒▒▒▒                            ← consumed 3 tokens
         │  ▒▒▒▒▒▒▒▒▒▒▒▒                       ← refilled 3 tokens
         └────────────────────────────► time
               consume            refill
```

---

## How it Works

### Token Bucket

1. A bucket is created per client with `capacity` tokens and a `refillRate`.
2. On each request, the bucket checks if at least one token is available.
3. If yes, one token is consumed and the request proceeds.
4. If no, the request is rejected with `429`.
5. Tokens refill at the configured rate over time. Unused tokens accumulate up to `capacity`.
6. The bucket handles bursts: a client can consume up to `capacity` tokens instantly.

### Sliding Window (Redis Sorted Set)

1. Each client's requests are stored in a sorted set with timestamps as scores.
2. Old entries outside the window are removed.
3. The count of entries in the set is the current request count.
4. If the count exceeds the limit, the request is rejected.
5. On each request, the current timestamp is added to the set.

---

## Advantages

- **Protection** — prevents resource exhaustion from aggressive or faulty clients
- **Fairness** — ensures one client cannot monopolise shared resources
- **Cost control** — limits expensive operations (export, email send, third-party API calls)
- **Predictable behaviour** — well-defined throughput bounds simplify capacity planning
- **Client feedback** — `429` with `Retry-After` header lets clients self-throttle

---

## Trade-offs

- **User experience** — legitimate users may be rate-limited if limits are too tight; choosing limits requires careful tuning
- **State overhead** — distributed rate limiting requires shared state (Redis); adds latency and complexity
- **Inaccuracy** — fixed window allows 2x bursts at window boundaries; sliding window is more accurate but expensive
- **Hard to configure** — optimal limits depend on traffic patterns, which change over time
- **Bypass potential** — clients can rotate IPs or API keys to circumvent IP-based limits

---

## When to Use

- **Public APIs** — prevent abuse, ensure fair usage across tenants
- **Authentication endpoints** — login, password reset, registration (brute-force protection)
- **Expensive endpoints** — report generation, bulk data export, AI inference
- **Third-party API wrappers** — stay within upstream provider rate limits
- **Webhook delivery** — limit retry frequency to prevent flooding the target

---

## When NOT to Use

- **Internal services with known traffic patterns** — coordination overhead may not justify the benefit
- **Systems requiring predictable latency** — rate limiting adds a check on every request
- **When clients cannot handle 429** — some legacy or simple clients cannot retry; rate limiting causes failures instead of overload

---

## Related Concepts

- [Circuit Breaker](circuit-breaker.md) — circuit breaker stops calls to a failing downstream; rate limiter stops calls from an aggressive client
- [Backpressure](backpressure.md) — rate limiting is a form of backpressure applied at the entry point
- [Retry Pattern](retry-pattern.md) — clients should use exponential backoff when they receive a 429
- [Throttling](throttling.md) — rate limiting and throttling are related but different (throttling slows down rather than rejects)
- [Bulkhead Pattern](bulkhead-pattern.md) — isolates resources so one client's rate limit exhaustion does not affect others
- [Graceful Shutdown](graceful-shutdown.md) — rate limiters should be drained during shutdown

---

## Key Takeaways

> Rate limiting controls how many requests a client can make within a time window. Token bucket is the most common algorithm — it allows bursts up to a capacity while enforcing a sustainable average rate. For distributed systems, use a shared store (Redis) to maintain consistent limits across instances. Return `429 Too Many Requests` with a `Retry-After` header so clients can self-throttle using exponential backoff. Rate limiting is a first line of defence against abuse and overload, but must be paired with Circuit Breaker, Backpressure, and Bulkhead for comprehensive resilience.
