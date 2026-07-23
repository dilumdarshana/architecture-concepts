# Rollout Strategies

> Techniques for deploying changes safely by controlling who sees new code and when.

---

## What is it?

**Rollout strategies** control how new code is released to users. Instead of deploying a change to every user simultaneously, you gradually expose it to a subset — monitoring for errors, performance regressions, or unexpected behaviour — before full rollout.

---

## Problem

Deploying a breaking change to 100% of users at once is risky:

- A bug in the payment flow affects every customer immediately
- A performance regression in the dashboard slows all users
- A new feature confuses users who have not seen it before
- Rollback requires a full redeploy, wasting time and risking data loss

Without gradual rollout, you cannot test in production safely.

---

## Example

**Feature flag** — toggle a new checkout flow:

```typescript
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: 'redis://localhost:6379' });

// Feature flag service (Redis-backed for low latency)
async function isEnabled(flag: string, userId: string): Promise<boolean> {
  const flags = await redis.get(`feature:${flag}`);
  if (!flags) return false;

  const config = JSON.parse(flags);
  return config.enabled && config.userIds.includes(userId);
}

// Middleware — enable checkout v2 for specific users
async function featureFlag(flag: string, req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id;
  if (await isEnabled(flag, userId)) {
    return checkoutV2Router(req, res, next);
  }
  return checkoutV1Router(req, res, next);
}

app.use('/checkout', (req, res, next) => featureFlag('checkout-v2', req, res, next));
```

**Percentage rollout** — gradually increase traffic:

```typescript
import { createHash } from 'crypto';

async function percentageRollout(userId: string, percentage: number): Promise<boolean> {
  // Deterministic: same user always gets same result
  const hash = createHash('sha256').update(userId).digest('hex');
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;
  return bucket < percentage;
}

// 10% of users get the new checkout
if (await percentageRollout(userId, 10)) {
  return checkoutV2Router(req, res, next);
}
```

---

## Architecture / Flow

```text
Client                          API Gateway
  │                                  │
  │  GET /checkout                   │
  │─────────────────────────────────►│
  │                                  │  Check feature flag
  │                                  │  ┌────────────────┐
  │                                  │  │ userId = abc   │
  │                                  │  │ bucket = 5     │
  │                                  │  │ percentage = 10│
  │                                  │  │ → route to v2  │
  │                                  │  └────────────────┘
  │                                  │
  │  200 OK (v2 response)            │
  │◄─────────────────────────────────│
```

---

## Strategies

| Strategy | How It Works | Use When |
|----------|-------------|----------|
| **Feature flags** | Toggle code paths on/off via configuration | Gradual feature enablement, A/B testing, kill switches |
| **Percentage rollout** | Route a fixed % of users to new code | Safe production testing at scale |
| **Canary release** | Deploy new version alongside old, route 1-5% traffic | High-risk deployments, infrastructure changes |
| **A/B testing** | Randomly assign users to variant A or B, measure outcomes | Product experiments, UX optimisation |
| **Allowlist** | Only specific user IDs see the new code | Internal testing, beta users, specific customers |
| **Shadow traffic** | Send real traffic to new version but do not return the response | Testing new version without user impact |

---

## How it Works

1. Define a feature flag or rollout percentage in a config service (Redis, database, or feature flag platform)
2. Middleware or gateway checks the flag before routing to the new code path
3. Monitor error rates, latency, and business metrics for the new code
4. If metrics look healthy, increase the percentage
5. If metrics degrade, roll back by disabling the flag (instant, no deploy needed)
6. Once at 100% and stable for a defined period, remove the flag and old code path

---

## Feature Flag Lifecycle

```text
Define → Enable for allowlist → Enable for % → Enable for all → Remove flag
  │              │                   │               │              │
  └── config     └── beta users     └── gradual     └── full       └── cleanup
                      rollout          rollout          rollout
```

---

## Deterministic Bucketing

Percentage rollouts must be **deterministic** — the same user always gets the same result. A random choice per request causes flapping and inconsistent UX:

```typescript
import { createHash } from 'crypto';

// BAD: non-deterministic — user flaps between v1 and v2
function rollout(userId: string, percentage: number): boolean {
  return Math.random() * 100 < percentage;  // changes every request
}

// GOOD: deterministic — same user always gets same result
function rollout(userId: string, percentage: number): boolean {
  const hash = createHash('sha256').update(userId).digest('hex');
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;
  return bucket < percentage;
}
```

---

## Advantages

- **Safe production testing** — detect issues before full rollout
- **Instant rollback** — disable a flag without redeploying
- **Reduced blast radius** — a bug affects only a subset of users
- **Data-driven decisions** — A/B testing measures real user behaviour
- **Beta programs** — specific customers can preview features early

---

## Trade-offs

- **Flag debt** — flags that are never removed accumulate and create testing complexity
- **Configuration sprawl** — many flags become hard to manage and document
- **Testing matrix** — code paths multiply with each flag, making full test coverage harder
- **Operational overhead** — flag evaluation adds latency (mitigated by Redis caching)
- **Consistency risk** — users see different versions across sessions if flags change mid-session

---

## When to Use

- Any deployment where a rollback would be costly
- High-traffic services where a bug affects many users
- Product experiments that need measurable outcomes
- Regulated environments where changes must be gradual and auditable

---

## When NOT to Use

- Trivial changes (typo fixes, dependency updates) — deploy directly
- Internal tools with a single user — no need for gradual rollout
- Emergency hotfixes — deploy immediately, then monitor
- Systems where all users must see the same version (e.g., real-time collaborative editing)

---

## Related Concepts

- [API Versioning](api-versioning.md) — versioned endpoints coexist with feature flags for gradual migration
- [Circuit Breaker](circuit-breaker.md) — automatically disable a feature when downstream errors spike
- [Rate Limiting](rate-limiting.md) — limit traffic to new code paths during rollout
- [Graceful Shutdown](graceful-shutdown.md) — shut down deprecated code paths cleanly after rollout completes
- [Idempotency](idempotency.md) — ensure flag evaluations are consistent across retries

---

## Key Takeaways

> Feature flags and percentage rollouts let you test changes in production with minimal risk. Use deterministic bucketing so users see a consistent experience. Start with an allowlist of internal users, then ramp to 10% → 50% → 100%. Monitor error rates and latency at each stage. Remove flags after full rollout to avoid flag debt. The goal is instant rollback without redeploy.
