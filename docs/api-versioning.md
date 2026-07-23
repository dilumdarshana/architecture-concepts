# API Versioning

> Strategies for evolving HTTP APIs without breaking existing clients.

---

## What is it?

**API versioning** assigns a version identifier to each API surface so that breaking changes can be introduced without breaking existing clients. Clients that have not upgraded continue to receive the old response format; new clients use the latest version.

---

## Problem

APIs evolve. New fields are added, response shapes change, endpoints are reorganised. Without versioning:

- A field rename in a JSON response breaks every client that reads that field
- A breaking change forces all clients to deploy simultaneously
- Older mobile clients that cannot update in time lose access to the API
- Rollback becomes impossible — reverting the API breaks clients that already upgraded

---

## Example

**URL prefix versioning** — the most common approach:

```typescript
import { Router } from 'express';

const v1Router = Router();
const v2Router = Router();

v1Router.get('/orders', async (req, res) => {
  const orders = await prisma.order.findMany();
  res.json(orders.map(o => ({
    id: o.id,
    amount: o.totalAmount,           // v1: "amount"
  })));
});

v2Router.get('/orders', async (req, res) => {
  const orders = await prisma.order.findMany();
  res.json(orders.map(o => ({
    id: o.id,
    totalAmount: o.totalAmount,      // v2: renamed to "totalAmount"
    discountCode: o.discountCode,    // v2: new field
  })));
});

app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);
```

**Header-based versioning** — client specifies version via `Accept` header:

```typescript
// Client request:
// GET /api/orders
// Accept: application/vnd.myapp.v2+json

app.get('/api/orders', async (req, res) => {
  const version = parseVersion(req.headers.accept);  // "2"
  const orders = await prisma.order.findMany();

  if (version === '1') {
    return res.json(orders.map(o => ({ id: o.id, amount: o.totalAmount })));
  }
  return res.json(orders.map(o => ({ id: o.id, totalAmount: o.totalAmount })));
});
```

---

## Architecture / Flow

```text
Client                          API Gateway / Router
  │                                      │
  │  GET /api/v2/orders                  │
  │─────────────────────────────────────►│
  │                                      │  Route to v2Router
  │                                      │──────────► v2 handler
  │                                      │
  │  GET /api/v1/orders                  │
  │─────────────────────────────────────►│
  │                                      │  Route to v1Router
  │                                      │──────────► v1 handler
```

---

## Versioning Strategies

| Strategy | How It Works | Pros | Cons |
|----------|-------------|------|------|
| **URL prefix** | `/api/v1/orders` | Explicit, easy to route, cacheable | Clutters URL, version in path |
| **Query parameter** | `/api/orders?version=2` | Simple to implement | Easy to forget, not cacheable |
| **Accept header** | `Accept: application/vnd.app.v2+json` | Clean URLs, content negotiation | Harder to test in browser, less discoverable |
| **Request header** | `X-API-Version: 2` | Simple | Non-standard, easy to forget |

**Recommendation:** URL prefix for public APIs (explicit, documented, cacheable). Header-based for internal APIs where you control all clients.

---

## How it Works

1. Assign a version number to the API (major version for breaking changes)
2. Mount a separate router per version in Express
3. Each version handles requests independently with its own handler logic
4. Shared services (auth, database, utilities) are injected into versioned handlers — they are NOT versioned
5. Deprecate old versions with a timeline and `Deprecation` header
6. Remove old versions after all clients have migrated

---

## Shared Services Pattern

Version-specific routers share common services:

```typescript
// Shared service — NOT versioned
class OrderService {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll() {
    return this.prisma.order.findMany();
  }
}

// v1 handler — transforms for v1 response
async function getOrdersV1(req: Request, res: Response) {
  const orders = await orderService.findAll();
  res.json(orders.map(o => ({ id: o.id, amount: o.totalAmount })));
}

// v2 handler — transforms for v2 response
async function getOrdersV2(req: Request, res: Response) {
  const orders = await orderService.findAll();
  res.json(orders.map(o => ({
    id: o.id,
    totalAmount: o.totalAmount,
    discountCode: o.discountCode,
  })));
}

// Mount
v1Router.get('/orders', getOrdersV1);
v2Router.get('/orders', getOrdersV2);
```

---

## Deprecation Timeline

When retiring a version:

1. Add `Deprecation: true` header to responses from the old version
2. Add `Sunset: <date>` header with a clear deadline
3. Log usage of the deprecated version to identify remaining clients
4. After the deadline, return `410 Gone` with a migration guide

```typescript
function deprecationMiddleware(version: string, sunsetDate: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (version === 'v1') {
      res.set('Deprecation', 'true');
      res.set('Sunset', sunsetDate);
    }
    next();
  };
}
```

---

## Advantages

- **Non-breaking rollout** — deploy new API versions without upgrading all clients
- **Rollback safety** — if v2 has issues, clients still on v1 are unaffected
- **Clear migration path** — version numbers give clients a concrete target to upgrade to
- **Independent versioning** — different endpoints can evolve at different rates

---

## Trade-offs

- **Code duplication** — multiple routers with overlapping logic
- **Maintenance burden** — old versions must be supported until all clients migrate
- **Route proliferation** — URL versioning increases the number of routes
- **Consistency risk** — shared services must be backward compatible across all versions

---

## When to Use

- Public APIs consumed by external clients (mobile apps, third parties)
- APIs with multiple client versions deployed simultaneously
- APIs where breaking changes are expected over time

---

## When NOT to Use

- Internal APIs where you control all consumers and can deploy atomically
- APIs that are unlikely to change (utility endpoints, health checks)
- GraphQL APIs — use schema evolution instead of versioned endpoints

---

## Related Concepts

- [Event Versioning](event-versioning.md) — versioning event schemas for event-driven systems
- [Graceful Shutdown](graceful-shutdown.md) — shutting down deprecated API versions cleanly
- [Rate Limiting](rate-limiting.md) — applying different rate limits per API version
- [Error Handling (Express)](error-handling.md) — centralized error middleware across versioned routes

---

## Key Takeaways

> URL prefix versioning (`/api/v1/orders`) is the simplest, most explicit strategy for public APIs. Mount a separate Express router per version; share services and utilities between them. Add `Deprecation` and `Sunset` headers to retire old versions on a clear timeline. Breaking changes get a new version; additive changes are always safe within the same version.
