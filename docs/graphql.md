# GraphQL

> A query language and runtime for APIs that lets clients request exactly the data they need from a single endpoint.

---

## What is it?

**GraphQL** is a specification and runtime developed by Meta that exposes a single HTTP endpoint (typically `POST /graphql`). Clients send queries that describe the exact shape and depth of data they require. The server resolves the query by executing each field through a chain of **resolvers**, fetching data from databases, services, or other APIs. GraphQL supports three operation types: **queries** (read), **mutations** (write), and **subscriptions** (real-time).

---

## Problem

[REST](rest.md) APIs suffer from two well-known data-fetching problems:

- **Over-fetching** — a `GET /orders/:id` endpoint returns the full order object (customer, line items, timestamps, metadata) even when the client only needs the order total
- **Under-fetching / waterfall requests** — a dashboard view needs order data, customer info, and product details, requiring 3-5 sequential REST calls

Both problems grow as client applications (especially mobile and complex SPAs) demand different data shapes across screens. Adding new client requirements often means either adding new REST endpoints or bloating existing ones.

GraphQL solves both by putting the client in control of the query shape.

---

## Example

### Schema Definition

```graphql
type Query {
  order(id: ID!): Order
  orders(customerId: ID): [Order!]!
  customer(id: ID!): Customer
}

type Mutation {
  createOrder(input: CreateOrderInput!): Order!
  cancelOrder(id: ID!): Order!
}

type Order {
  id: ID!
  customer: Customer!
  total: Float!
  status: OrderStatus!
  items: [OrderItem!]!
  createdAt: String!
}

type Customer {
  id: ID!
  name: String!
  email: String!
  orders: [Order!]!
}

type OrderItem {
  productId: ID!
  productName: String!
  quantity: Int!
  price: Float!
}

enum OrderStatus { PENDING CONFIRMED CANCELLED }

input CreateOrderInput {
  customerId: ID!
  items: [OrderItemInput!]!
}

input OrderItemInput {
  productId: ID!
  quantity: Int!
}
```

### Node.js / TypeScript — Apollo Server with Resolvers

```typescript
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const typeDefs = `#graphql
  type Query {
    order(id: ID!): Order
    customer(id: ID!): Customer
  }

  type Order {
    id: ID!
    total: Float!
    status: String!
    customer: Customer!
  }

  type Customer {
    id: ID!
    name: String!
    email: String!
  }
`;

const resolvers = {
  Query: {
    order: async (_: any, args: { id: string }) => {
      return prisma.order.findUnique({ where: { id: args.id } });
    },
    customer: async (_: any, args: { id: string }) => {
      return prisma.customer.findUnique({ where: { id: args.id } });
    },
  },
  Order: {
    customer: async (parent: { customerId: string }) => {
      return prisma.customer.findUnique({ where: { id: parent.customerId } });
    },
  },
};

const server = new ApolloServer({ typeDefs, resolvers });
const { url } = await startStandaloneServer(server, { listen: { port: 4000 } });
console.log(`GraphQL endpoint at ${url}`);
```

### Client-driven query — no over-fetching

```graphql
# Client A — dashboard needs only total and status
query {
  order(id: "ord-123") {
    total
    status
  }
}

# Client B — details page needs full data
query {
  order(id: "ord-123") {
    total
    status
    customer { name email }
    items { productName quantity price }
  }
}
```

---

## Architecture / Flow

```text
Client                              Server
  │                                    │
  │  POST /graphql                     │
  │  { "query": "{ order(id: \"1\")    │
  │      { total status } }" }         │
  │───────────────────────────────────►│
  │                                    │
  │                               ┌────┴────┐
  │                               │  Parse   │
  │                               │ & Validate│
  │                               └────┬────┘
  │                               ┌────┴────┐
  │                               │ Execute  │
  │                               │ ──────── │
  │                               │ Query    │
  │                               │   └── order(id: "1")
  │                               │         └── total
  │                               │         └── status
  │                               └────┬────┘
  │                               ┌────┴────┐
  │                               │ Resolve  │
  │                               │ order()  │
  │                               │   │       │
  │                               │   ▼       │
  │                               │ Prisma    │
  │                               │ findUnique│
  │                               └────┬────┘
  │                                    │
  │◄── 200 { "data": { "order": {     │
  │        "total": 29.99,             │
  │        "status": "CONFIRMED"       │
  │      } } }                         │
```

### Resolver chain

```text
Query.order(id: "1")
  │
  ├── order.total        → resolves from parent (field from DB)
  ├── order.status       → resolves from parent (field from DB)
  │
  └── order.customer     → custom resolver: queries Customer table
        │
        ├── customer.name   → from parent
        └── customer.email  → from parent
```

---

## How it Works

1. **Client sends a query** as a string in a `POST` request to the single GraphQL endpoint (typically `POST /graphql`).
2. **Server parses the query** string into an Abstract Syntax Tree (AST) and validates it against the schema (type checking, required arguments, field existence).
3. **Server executes the query** by walking the AST top-down. For each field, it calls the corresponding **resolver** function.
4. **Resolver reads the parent object** — fields that map directly to database columns resolve from the parent object without a custom resolver (default resolver behaviour).
5. **Resolver makes data fetches** — for relational fields (e.g. `order.customer`), the resolver calls Prisma, a REST API, or another service.
6. **DataLoader batches and caches** — the N+1 problem occurs when resolvers fetch related data in a loop. DataLoader batches those fetches into a single query and caches results per request.
7. **Server assembles the response** — the resolved data is shaped exactly as the query specified and returned in a `{ "data": { ... } }` structure.
8. **Client receives exactly the requested shape** — no over-fetching, no under-fetching, no multiple round trips.

---

## Advantages

- **Client-driven queries** — the client specifies the exact fields it needs; no over-fetching or under-fetching
- **Single endpoint** — no versioning URL scheme; the schema evolves via additive changes (new fields, deprecated old ones)
- **Strongly typed schema** — the schema is a contract: every field has a type, every argument is validated at query time
- **Batched relationship resolution** — DataLoader eliminates the N+1 problem by batching and caching per-request data fetches
- **Rapid frontend iteration** — frontend teams add new UI components without requesting new backend endpoints
- **Subscription support** — GraphQL subscriptions provide a built-in real-time model via WebSocket, unlike REST which requires a separate protocol

---

## Trade-offs

- **Query complexity and cost** — an expensive query (e.g. requesting thousands of nested records) can overload the server; query depth limiting, cost analysis, or timeouts are needed
- **Caching is harder than REST** — HTTP caching at the URL level does not work because every query uses `POST /graphql`; application-level caching (response caching, DataLoader, CDN for persisted queries) requires additional infrastructure
- **N+1 problem** — without DataLoader, resolvers that fetch related data in a loop cause N+1 database queries; DataLoader solves this but adds complexity
- **File uploads** — GraphQL has no native file upload support; multipart request specifications (e.g. `graphql-upload`) are community extensions, not part of the spec
- **Overhead for simple APIs** — for straightforward CRUD, the schema and resolver boilerplate outweighs the benefit over a simple [REST](rest.md) endpoint
- **Rate limiting is nuanced** — because a single request can trigger many backend operations, rate limiting by request count is insufficient; cost-based rate limiting (analysing query complexity) is needed

---

## When to Use

- **Complex UIs with multiple data sources** — dashboards, mobile apps, and SPAs that aggregate data from several services
- **Rapidly evolving frontends** — when frontend requirements change faster than backend APIs can keep up
- **Bandwidth-constrained clients** — mobile apps benefit from fetching exactly the data they need over potentially slow connections
- **Polyglot data sources** — a single GraphQL gateway can unify REST APIs, databases, and gRPC services behind one schema
- **Microservices aggregation** — GraphQL federation or schema stitching composes multiple subgraph services into a single unified graph

---

## When NOT to Use

- **Simple CRUD APIs** — [REST](rest.md) is simpler, more cacheable, and requires less boilerplate for basic create-read-update-delete operations
- **High-frequency, small payload requests** — the additional query parse/validate/resolve overhead is not justified when each request is a simple lookup
- **File-upload-centric applications** — REST handles file uploads natively with `multipart/form-data`; GraphQL requires non-standard extensions
- **Public APIs with diverse consumers** — REST's universal HTTP caching, tooling (curl, Postman, OpenAPI), and simpler mental model are better for third-party API consumers
- **Performance-critical internal service calls** — [gRPC](grpc.md) offers binary serialisation, streaming, and statically generated clients with lower overhead than a GraphQL query execution pipeline

---

## Related Concepts

- [REST](rest.md) — resource-oriented API style; GraphQL complements REST by solving over-fetching and waterfall requests
- [gRPC](grpc.md) — typed RPC framework for high-performance inter-service communication; an alternative to GraphQL for server-to-server calls
- [API Versioning](api-versioning.md) — GraphQL reduces versioning needs via additive schema evolution, but breaking changes still require deprecation strategies
- [Caching Strategies](caching-strategies.md) — application-level caching patterns for GraphQL (response caching, persisted queries, CDN-level caching with GET requests)
- [Handling Eventual Consistency](handling-eventual-consistency.md) — GraphQL subscriptions provide real-time updates; useful for propagating eventually consistent state changes to clients
- [Microservices](microservices.md) — GraphQL federation composes multiple microservice graphs into a single endpoint

---

## Key Takeaways

> GraphQL gives clients control over the shape and depth of API responses, solving the over-fetching and waterfall problems inherent in [REST](rest.md). A single typed schema serves queries, mutations, and subscriptions. The N+1 problem must be addressed with DataLoader. GraphQL excels for complex UIs, mobile apps, and microservice aggregation but adds complexity for simple CRUD and makes HTTP caching harder. For high-performance internal service calls, [gRPC](grpc.md) remains the better choice.
