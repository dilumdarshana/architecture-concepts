# Multi-Tenancy

> A single software instance serving multiple customers (tenants) while keeping each tenant's data logically isolated.

---

## What is it?

Multi-tenancy is an architecture where one application and one database deployment serve many distinct customers, called tenants (e.g. a SaaS company serving thousands of companies). Each tenant's data and settings are isolated from every other tenant, so a tenant can only see and modify its own data. The opposite is single-tenancy — one dedicated instance per customer (also called dedicated or enterprise deployment).

The core idea is sharing infrastructure while preserving per-tenant isolation. The design tension is always the trade-off between **cost/efficiency** (share everything) and **isolation** (keep tenants apart).

---

## Problem

Selling the same product to many customers raises a scaling and isolation dilemma:

- Running one instance per customer is costly — N customers means N deployments, databases, and complex release pipelines.
- A shared instance serves everyone cheaply, but a bug or a malicious query in one tenant must never leak another tenant's data.
- Tenants differ in size: a small customer needs little, an enterprise needs dedicated capacity and stricter guarantees.
- Some customers require compliance or contract-level isolation (e.g. "my data must not sit on the same database as competitor X").

Without an explicit tenancy model, developers end up ad-hoc filtering by a customer column, risking data leaks and making it impossible to safely escalate a single tenant.

---

## Example

### Three Isolation Models

The data layer is where the decision lives:

| Model | Data Layout | Isolation | Cost / Scale | Best For |
|-------|-------------|-----------|--------------|----------|
| **Shared schema** (pool) | All tenants in one database, same tables, rows tagged with `tenant_id` | Weakest — row-level filtering only | Cheapest, most efficient, simplest ops | Early SaaS with many small, low-risk tenants |
| **Shared database, separate schema** | One database, one schema per tenant | Medium — schema-level separation | Moderate | Medium tenants; moderate isolation at low cost |
| **Separate database** (silo) | One database per tenant | Strongest — full physical separation | Most expensive, most operational overhead | Enterprises, regulated/compliance-heavy tenants |

Note these are not mutually exclusive — mature SaaS platforms usually mix models: small tenants share a pool, large tenants get a silo.

### Node.js Tenant-Aware Client

A shared-schema app derives the tenant from the request context and forces every query through it:

```sql
-- Every row carries the tenant. All queries filter on it.
SELECT * FROM orders WHERE tenant_id = 'acme' AND id = 42;
```

```typescript
import { PrismaClient } from '@prisma/client';
import { tenantContext } from './tenant-context';

const prisma = new PrismaClient();

async function getOrder(orderId: string) {
  const { tenantId } = tenantContext.get(); // set per-request by middleware

  // The tenant predicate is always present — never accept client-supplied tenantId
  return prisma.order.findFirst({
    where: { id: orderId, tenantId }
  });
}

async function createOrder(data: OrderInput) {
  const { tenantId } = tenantContext.get();
  return prisma.$transaction(async (tx) => {
    return tx.order.create({ data: { ...data, tenantId } });
  });
}
```

Routing to a silo uses a tenant-to-database mapping:

```typescript
const pools: Record<string, PrismaClient> = {
  acme: new PrismaClient({ datasourceUrl: process.env.ACME_DB_URL }),
  globex: new PrismaClient({ datasourceUrl: process.env.GLOBEX_DB_URL }),
};

async function createOrder(tenantId: string, data: OrderInput) {
  const prisma = pools[tenantId]; // look up the tenant's database
  if (!prisma) throw new Error('Unknown tenant');
  return prisma.order.create({ data });
}
```

---

## Architecture / Flow

```text
                      ┌──────────────┐
                      │   Client A    │   Client B    │   Client C
                      │  (tenant: A) │  (tenant: B)  │  (tenant: C)
                      └──────┬───────┘      │              │
                             │              │              │
                      ┌──────▼──────────────▼──────────────▼──────┐
                      │           API Gateway / App               │
                      │      resolves tenant from token/domain     │
                      └──────┬─────────────────────────────────────┘
                             │  sets tenant context
                      ┌──────▼──────┐
                      │ Tenant-aware│
                      │ data layer  │
                      └──────┬──────┘
                             │
        ┌────────────────────┼───────────────────────┐
        │ pooled (shared)    │ per-schema            │ per-database
        │ DB + tenant_id     │ DB + schema           │ (silo)
        └────────────────────┴───────────────────────┘
```

Tenant resolution happens once, at the boundary, and is threaded through the request via context — never re-derived from client input inside the service.

---

## How it Works

1. **Identify the tenant at the boundary.** Derive `tenant_id` from the authenticated principal (JWT/OIDC claim), the subdomain (`acme.saas.com`), or a header — before the request reaches business logic.
2. **Propagate the tenant into a per-request context.** Store `tenantId` in an `AsyncLocalStorage`-style context (or middleware `res.locals`) so every downstream call reads it, avoiding every function having to carry it explicitly.
3. **Scope every data access.** All queries and writes include the tenant predicate. Add a composite index `(tenant_id, ...)` to keep per-tenant queries fast.
4. **Enforce isolation in the database layer.** Use restrictive [row-level security (RLS)](row-level-security.md) policies as a backstop: even a code path that forgets `WHERE tenant_id` cannot cross tenant boundaries.
5. **Route to the right data store.** In pooled models, all tenants share tables; in silo models, resolve the tenant's connection/database from a mapping and use it.
6. **Isolate across the whole stack.** Not just data — queues, caches, rate limits, and logging should be partitioned per tenant (e.g. cache keys prefixed by `tenantId`, per-tenant priority).
7. **Test for cross-tenant leaks.** Write a test that tenant A cannot read tenant B's data for every protected resource — constant regression coverage on the security boundary.

---

## Advantages

- **Lower cost** — one deployment and shared infrastructure serve all tenants; you pay for capacity, not per-customer hardware
- **Faster time to onboard** — a new tenant uses the running system, no provisioning or installation
- **Centralised operations** — one version, one schema, one set of migrations; upgrades reach every tenant at once
- **Better resource utilisation** — idle capacity in one tenant's workload is used by others
- **Easier analytics** — cross-tenant reporting and admin tooling operate on a single dataset (in the shared model)

---

## Trade-offs

- **Shared-schema isolation risk** — a missing `WHERE tenant_id`, an IDOR bug, or a misconfigured query is a cross-tenant data leak, which is a security incident; mitigation needs RLS, constant testing, and careful code
- **Noisy neighbour problem** — one tenant's heavy queries or jobs degrade everyone else's performance; needs per-tenant rate limiting and fair scheduling
- **Noisy tenant on noisy infrastructure** — a single runaway tenant can consume shared cache/queue capacity
- **Uniform upgrade blast radius** — a bad migration or deploy breaks every tenant simultaneously (in pooled models)
- **Operational complexity** — mixing pooled and siloed models means a routing layer and a migration path as tenants grow
- **Compliance limitations** — some contracts/regulators require physical separation, which shared models cannot offer

---

## When to Use

- **B2B SaaS** with many small/medium customers who don't require physical data isolation
- Early-stage products where cost and developer velocity matter more than absolute isolation
- Building a platform where onboarding a new tenant must be instant and self-serve
- Products where per-tenant analytics and rollups are valuable and straightforward to build

---

## When NOT to Use

- **High-stakes, regulated workloads** (health records, financial/PII-heavy data) that legally require dedicated infrastructure → use silos or single-tenancy
- **Very few, very large enterprises** — one dedicated tenant per deployment may be simpler and cheaper than a routing layer
- **Where per-tenant customisation is extreme** — some customers need custom schemas/code that a shared pool cannot tolerate
- **If you don't yet have per-tenant isolation enforced** — nothing is worse than a shared model without RLS; prefer a silo until the security discipline is in place

---

## Related Concepts

- [Sharding](sharding.md) — multi-tenancy isolates per-tenant; sharding splits data for scale; the shared-schema model is often sharded by `tenant_id`
- [Caching Strategies](caching-strategies.md) — partition cache keys by tenant to prevent cross-tenant cache collision
- [API Authentication](api-authentication.md) — OIDC/JWT claims are the usual source of `tenant_id`
- [OpenID Connect (OIDC)](oidc.md) — tenant identity often comes from OIDC claims, with the tenant in the `audience` or a custom claim
- [Rate Limiting](rate-limiting.md) — per-tenant rate limiting to prevent noisy tenants degrading others
- [Bulkhead Pattern](bulkhead-pattern.md) — per-tenant connection pools and job queues to bound noisy neighbour impact
- [Database Concurrency Control](database-concurrency-control.md) — tenant-scoped indexes and locking
- [Row Level Security (RLS)](row-level-security.md) — the database-layer backstop that enforces tenant isolation even when a `WHERE` clause is forgotten
- [OWASP Top 10 (IDOR)](owasp-top-10.md) — the inverted/missing access-control flaw that causes cross-tenant leaks

---

## Key Takeaways

> Multi-tenancy lets one instance serve many customers while keeping their data isolated — the central question is the trade-off between cost/efficiency and isolation. The three models, from cheapest to most isolated, are shared schema, shared database with per-tenant schemas, and separate databases per tenant. The shared-schema (pool) model carries the biggest security risk, so isolation must be enforced with `tenant_id` scoping AND database row-level security as a backstop, plus regression tests proving no cross-tenant access is possible. Derive and hold the tenant in a per-request context, and scope the entire stack — data, caches, queues, and rate limits — not just the database. Real platforms usually mix models: many small tenants in a pool, large or regulated tenants in silos.
