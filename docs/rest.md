# REST

> An architectural style for designing networked applications using stateless operations on uniform resource identifiers over HTTP.

---

## What is it?

**REST** (Representational State Transfer) is an architectural style defined by Roy Fielding that treats server data as **resources** identified by URLs. Clients manipulate resources through **representations** (typically JSON) exchanged via standard HTTP methods. A RESTful API adheres to six constraints: uniform interface, stateless, cacheable, client-server, layered system, and optionally code-on-demand.

---

## Problem

Before REST, HTTP APIs often lacked a consistent structure:

- **No resource orientation** — endpoints were action-based (`/getUser`, `/createOrder`, `/deleteItem`) rather than resource-based (`GET /users/:id`, `POST /orders`)
- **Inconsistent status codes** — every error returned `200 OK` with an error message in the body, forcing clients to parse response text to detect failure
- **No standard for versioning** — breaking changes shipped without clear signalling
- **Client-server coupling** — clients needed to know server-side action names rather than navigating resources

REST solved these by enforcing a uniform interface: resources, methods, representations, and hypermedia as the engine of application state.

---

## Example

### Resource-oriented endpoints

| Method | URL | Action | Success Code |
|--------|-----|--------|-------------|
| `GET` | `/orders` | List all orders | 200 |
| `POST` | `/orders` | Create an order | 201 |
| `GET` | `/orders/:id` | Get one order | 200 |
| `PUT` | `/orders/:id` | Replace an order | 200 |
| `PATCH` | `/orders/:id` | Partial update | 200 |
| `DELETE` | `/orders/:id` | Delete an order | 204 |

### Node.js / TypeScript — Express with Resource Naming and Status Codes

```typescript
import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.get('/orders', async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany();
  res.json(orders);
});

app.post('/orders', async (req: Request, res: Response) => {
  const order = await prisma.order.create({ data: req.body });
  res.status(201).json(order);
});

app.get('/orders/:id', async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});
```

### Error handling with consistent status codes

```typescript
// 400 — client error
app.post('/orders', async (req: Request, res: Response) => {
  const { customerId, total } = req.body;
  if (!customerId || !total) {
    return res.status(400).json({ error: 'customerId and total are required' });
  }
  const order = await prisma.order.create({ data: { customerId, total } });
  res.status(201).json(order);
});

// 409 — conflict (e.g. idempotency key reuse)
app.post('/payments', async (req: Request, res: Response) => {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key: req.headers['idempotency-key'] as string }
  });
  if (existing) {
    return res.status(409).json({ error: 'Idempotency key already used' });
  }
  // process payment...
});
```

---

## Architecture / Flow

```text
Client                         Server
  │                               │
  │  GET /orders                  │
  │──────────────────────────────►│
  │                               │──► Controller
  │                               │──► Service
  │                               │──► Data Access (Prisma)
  │                               │
  │◄── 200 [ { id, total, ... } ] │
  │                               │
  │  POST /orders                 │
  │  { customerId, total }        │
  │──────────────────────────────►│
  │                               │──► Validate body
  │                               │──► Create resource
  │                               │──► Return location
  │◄── 201 { id, customerId, ... }│
  │                               │
  │  GET /orders/abc              │
  │──────────────────────────────►│
  │◄── 404 { error: "not found" } │
```

### Middleware stack

```text
Request
  │
  ▼
Logger ─► Auth ─► Rate Limiter ─► Router ─► Controller ─► Response
                                                        │
                                                        ▼
                                                   Error Middleware
                                                        │
                                                        ▼
                                                   Error Response
```

---

## How it Works

1. **Client identifies a resource** via a URL (e.g. `GET /orders/42`).
2. **Request reaches the server** and passes through middleware layers (logging, auth, rate limiting).
3. **Router matches the URL** to a handler based on HTTP method and path.
4. **Handler processes the request** — validates input, applies business logic, queries or mutates data.
5. **Server returns a representation** of the resource (typically JSON) with the appropriate HTTP status code.
6. **Client receives the response** and interprets the status code and body independently of server-side state.
7. **Stateless constraint** — each request contains all information needed to process it; the server holds no session state between requests.
8. **Cacheability** — responses declare cache validity via `Cache-Control`, `ETag`, or `Last-Modified` headers, allowing intermediaries (CDNs, proxies, browser caches) to serve stale-while-revalidate responses.

---

## Advantages

- **Simple and ubiquitous** — HTTP is understood by every platform, language, and toolchain (curl, browser, Postman)
- **Cacheable** — standard HTTP caching semantics let CDNs and proxies reduce server load without custom logic
- **Evolvable** — resource orientation and hypermedia enable servers to change URL structure without breaking clients that follow links
- **Observable** — every request can be inspected, logged, and replayed because it carries full context in headers and body
- **Language agnostic** — any HTTP client can consume a REST API; no SDK generation required
- **Well-understood tooling** — OpenAPI, Swagger, Postman, API gateways, and monitoring tools all speak REST natively

---

## Trade-offs

- **Over-fetching / under-fetching** — a single endpoint returns a fixed response shape; clients often receive data they do not need or must make multiple requests to gather all required data
- **Multiple round trips** — assembling a complex UI view (e.g. order + customer + line items) requires sequential requests
- **No strict contract** — the API contract is documentation, not code; breaking changes can ship without compile-time detection
- **Versioning overhead** — evolving an API requires URL versioning (`/v1/`, `/v2/`) or header negotiation, adding maintenance burden
- **No subscription model** — real-time updates require WebSocket or SSE as a separate protocol alongside REST
- **Chatty interfaces** — fine-grained resources can cause excessive request overhead when clients need data from multiple endpoints

---

## When to Use

- **Public-facing APIs** — REST is the default choice for third-party and open APIs due to universal HTTP support
- **CRUD-dominated applications** — resource-oriented design maps naturally to create, read, update, delete operations
- **Simple integrations** — point-to-point communication between two services where the overhead of GraphQL or gRPC is not justified
- **Cacheable read-heavy workloads** — content delivery, product catalogs, reference data that benefit from HTTP caching
- **Rapid prototyping** — Express or Fastify with REST requires minimal boilerplate compared to defining schemas or proto files

---

## When NOT to Use

- **High-performance internal service communication** — [gRPC](grpc.md) provides typed contracts, binary serialisation, and streaming with lower overhead than JSON over HTTP/1.1
- **Complex UIs with multiple data sources** — [GraphQL](graphql.md) lets the client request exactly the data it needs in a single round trip, avoiding over-fetching and waterfall requests
- **Real-time bidirectional communication** — REST is request-response; use WebSocket, SSE, or gRPC streaming for live updates
- **Fine-grained, chatty interactions** — if clients frequently need small pieces of data from many endpoints, a single GraphQL endpoint or gRPC service may be more efficient

---

## Related Concepts

- [GraphQL](graphql.md) — alternative API paradigm that solves over-fetching and waterfall requests with client-driven queries
- [gRPC](grpc.md) — typed RPC framework for high-performance inter-service communication
- [API Versioning](api-versioning.md) — strategies for evolving REST APIs without breaking existing clients
- [Error Handling (Express)](error-handling.md) — centralised async error middleware for consistent error responses
- [Caching Strategies](caching-strategies.md) — HTTP caching and application-level cache patterns for REST endpoints
- [Rate Limiting](rate-limiting.md) — token bucket and sliding window algorithms to protect REST APIs from abuse
- [Connection Pooling](connection-pooling.md) — managing HTTP keep-alive connections for efficient REST client-server communication

---

## Key Takeaways

> REST is an architectural style that models server data as resources identified by URLs, manipulated through standard HTTP methods. It is simple, cacheable, and ubiquitous — the default choice for public APIs. However, it suffers from over-fetching and multiple round trips for complex views. For internal microservices, [gRPC](grpc.md) offers better performance and typed contracts; for data-flexible UIs, [GraphQL](graphql.md) eliminates waterfall requests. Always use consistent status codes (2xx success, 4xx client error, 5xx server error) and standard HTTP caching headers.
