# Row Level Security (RLS)

> A PostgreSQL feature that enforces row-level access control in the database itself, so a query can never return or modify rows the current session is not allowed to see.

---

## What is it?

Row Level Security (RLS) is a PostgreSQL security feature that restricts which rows a table's queries can access based on **policies** evaluated against the current role and session context. Instead of relying on the application to filter every query, the database itself decides which rows are visible and writable.

It is a **defense-in-depth backstop**: even if application code forgets a `WHERE tenant_id = ...` clause, the database refuses to return or modify rows outside the policy. RLS is the enforcement layer that makes a shared-schema [Multi-Tenancy](multi-tenancy.md) model safe.

---

## Problem

Application-level filtering is fragile. Authorization logic is scattered across the codebase, and a single mistake leaks data:

- A developer forgets the `WHERE tenant_id` predicate on one query.
- An IDOR bug lets a client pass an arbitrary `tenant_id` (see [OWASP Top 10](owasp-top-10.md)).
- A misconfigured ORM query or a raw SQL report bypasses the filter entirely.
- An admin tool, a cron job, or a direct DB connection reads across tenants.

Each of these is a cross-tenant data leak — a security incident. RLS moves the security boundary into the database, making it impossible to bypass accidentally, regardless of which code path issues the query.

---

## Example

### Enable RLS and Create a Policy

```sql
-- Every row carries the tenant. All queries filter on it.
CREATE TABLE orders (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  customer   TEXT NOT NULL,
  total      NUMERIC NOT NULL
);

-- 1. Turn RLS on for the table.
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 2. Create a policy that reads the tenant from the session context.
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant'))
  WITH CHECK (tenant_id = current_setting('app.current_tenant'));
```

The `USING` expression filters rows on read (`SELECT`, `UPDATE`, `DELETE`). The `WITH CHECK` expression validates rows on write (`INSERT`, `UPDATE`), so a query can never insert or update a row for another tenant.

### Node.js / Prisma

Prisma does not manage RLS policies directly, but you set the session context per transaction. `SET LOCAL` scopes the variable to the current transaction, which is safe with connection pooling:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getOrders(tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // Set the tenant for the duration of this transaction only.
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${tenantId}'`);

    // No WHERE clause needed — RLS filters to this tenant's rows.
    return tx.order.findMany();
  });
}
```

> **Security note:** never interpolate a client-supplied value into SQL. Derive `tenantId` from the authenticated principal (see [API Authentication](api-authentication.md)) and use a parameterised query or a trusted value. The example above is illustrative — use `$executeRaw` with parameters in production.

### Policy Command Types

A policy targets specific commands with `FOR`. Each command type uses `USING`, `WITH CHECK`, or both:

| Command | `USING` (read filter) | `WITH CHECK` (write validation) |
|---------|----------------------|--------------------------------|
| `FOR SELECT` | Yes | No |
| `FOR INSERT` | No | Yes |
| `FOR UPDATE` | Yes | Yes |
| `FOR DELETE` | Yes | No |
| `FOR ALL` | Yes | Yes |

A policy also targets roles with `TO`. The default is `PUBLIC` (all roles). Supabase-style setups target the built-in `anon` / `authenticated` roles:

```sql
-- Only the authenticated role can read; anon gets nothing
CREATE POLICY "health_check_read"
  ON public.health_check
  FOR SELECT
  TO authenticated
  USING (true);
```

More practical examples of the command types:

```sql
-- INSERT only: allow creating rows, but never for another tenant
CREATE POLICY tenant_insert ON orders
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant'));

-- UPDATE scoped to own tenant: can only change your own rows,
-- and cannot reassign them to another tenant
CREATE POLICY tenant_update ON orders
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant'))
  WITH CHECK (tenant_id = current_setting('app.current_tenant'));

-- DELETE scoped to own tenant
CREATE POLICY tenant_delete ON orders
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant'));
```

Role-based split — `anon` reads only public rows, `authenticated` reads and writes its own:

```sql
CREATE POLICY "public_read" ON public.products
  FOR SELECT
  TO anon
  USING (is_public = true);

CREATE POLICY "owner_write" ON public.products
  FOR ALL
  TO authenticated
  USING (owner_id = current_setting('app.user_id'))
  WITH CHECK (owner_id = current_setting('app.user_id'));
```

Layering policies — `PERMISSIVE` (default) OR's policies together, `RESTRICTIVE` AND's them on top:

```sql
-- A row passes if ANY permissive policy allows it
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant'));

-- ...but it must ALSO pass every restrictive policy
CREATE POLICY no_deleted_rows ON orders AS RESTRICTIVE
  USING (deleted_at IS NULL);
```

This is standard PostgreSQL — the same syntax works in any PostgreSQL database, not just Supabase.

### Supabase

Supabase is PostgreSQL under the hood, so all of the above works there. It adds a few **auth-specific functions** that read the JWT injected by Supabase's PostgREST layer — these are not portable to plain PostgreSQL:

| Function | Returns |
|----------|---------|
| `auth.uid()` | The authenticated user's ID (`sub` claim) |
| `auth.jwt()` | The full JWT claims as a JSON object |
| `auth.role()` | The user's role (`authenticated` or `anon`) |

The classic "users see only their own profile" pattern:

```sql
-- A user can only SELECT rows where the profile id matches their own user id
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());
```

Combined with the built-in roles, this gives a full read/write split:

```sql
-- anon can read public profiles only
CREATE POLICY "profiles_public_read"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (is_public = true);

-- authenticated users can read and update their own profile
CREATE POLICY "profiles_own_all"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
```

The equivalent in plain PostgreSQL replaces `auth.uid()` with a session variable:

```sql
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  USING (id = current_setting('app.user_id'));
```

---

## Architecture / Flow

```text
        ┌──────────────────────────────┐
        │  Request (tenant: acme)      │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  App sets session context    │
        │  SET LOCAL app.current_tenant│
        │  = 'acme'                    │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  Query: SELECT * FROM orders │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  PostgreSQL evaluates policy │
        │  USING (tenant_id =          │
        │    current_setting(...))     │
        └──────────────┬───────────────┘
                       │
        ┌──────────────▼───────────────┐
        │  Rows where tenant_id =      │
        │  'acme' are returned; all    │
        │  other rows are invisible    │
        └──────────────────────────────┘
```

RLS is evaluated **inside the database**, after the query is parsed but before rows are returned. The application never sees rows that fail the policy — it cannot accidentally leak them.

---

## How it Works

1. **Enable RLS on a table** with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Until a policy is created, the table is inaccessible to non-owner roles.
2. **Create policies** with `CREATE POLICY`. Each policy has a `USING` expression (controls which existing rows are visible) and a `WITH CHECK` expression (controls which new/updated rows are allowed). Policies target specific commands with `FOR SELECT` / `FOR INSERT` / `FOR UPDATE` / `FOR DELETE` / `FOR ALL` and specific roles with `TO role_name` (default `PUBLIC`).
3. **Set the session context per request.** The policy reads a value such as `current_setting('app.current_tenant')`, which the application sets at the start of each request or transaction.
4. **PostgreSQL evaluates the policy on every query.** For `SELECT`, `UPDATE`, and `DELETE`, rows failing `USING` are invisible. For `INSERT` and `UPDATE`, rows failing `WITH CHECK` are rejected with an error.
5. **Multiple policies combine.** By default policies are `PERMISSIVE` (OR'd together); `RESTRICTIVE` policies are AND'd, useful for layering tenant isolation on top of role-based rules.
6. **Owners and superusers bypass RLS** unless you use `FORCE ROW LEVEL SECURITY` or grant the table to a non-owner role. This is important for migrations and admin tooling.

---

## Advantages

- **Defense in depth** — the database enforces isolation even when application code has a bug.
- **Centralised authorization** — the security rule lives in one place (the policy), not scattered across queries.
- **Impossible to forget** — there is no `WHERE` clause to omit; the policy applies to every access path.
- **Covers all access paths** — ORM queries, raw SQL, admin tools, cron jobs, and direct DB connections all go through the same policy.
- **Auditable** — policies are declarative and reviewable in the schema, making the security boundary explicit.

---

## Trade-offs

- **Performance overhead** — the policy expression is evaluated on every query; a non-indexed `current_setting()` lookup can add cost. Keep policies simple and index the predicate column.
- **Complexity** — policies are SQL and can be hard to debug; a subtle `USING`/`WITH CHECK` mismatch can silently hide or reject rows.
- **Connection pooling friction** — session variables do not persist across pooled connections; you must set the context per transaction (`SET LOCAL`) or per connection.
- **Not a substitute for application authz** — RLS enforces *which rows* are visible, not *whether* a user may access the resource at all. You still need authentication and endpoint-level authorization.
- **Bypass risk** — table owners, superusers, and roles with `BYPASSRLS` ignore policies; a misconfigured role can defeat the backstop.

---

## When to Use

- **Shared-schema multi-tenancy** — the primary use case; RLS is the backstop that makes a pooled model safe (see [Multi-Tenancy](multi-tenancy.md)).
- **Row-level authorization** — users should only see their own records (e.g. `user_id = current_setting('app.user_id')`).
- **Compliance and audit requirements** — where you must prove that cross-tenant access is impossible at the data layer.
- **Defense against IDOR** — a second line of defence behind ownership checks (see [OWASP Top 10](owasp-top-10.md)).

---

## When NOT to Use

- **Single-tenant applications** — there is no row-level boundary to enforce; RLS adds overhead for no benefit.
- **When you need cross-tenant admin access** — a support or analytics role that must read all tenants would need to bypass RLS, defeating the point.
- **When policies would be too complex** — if the rule cannot be expressed simply, the overhead and debugging cost outweigh the benefit.
- **When you cannot reliably set session context** — if connection pooling makes per-request context unreliable, RLS may silently return empty or wrong results.
- **When physical isolation is required** — for regulated workloads, a [silo](multi-tenancy.md) (separate database per tenant) is stronger than any row-level policy.

---

## Related Concepts

- [Multi-Tenancy](multi-tenancy.md) — RLS is the database-layer backstop for the shared-schema isolation model
- [Database Concurrency Control](database-concurrency-control.md) — RLS works alongside locking and transactions; policies are evaluated within the transaction
- [OWASP Top 10 (IDOR)](owasp-top-10.md) — RLS is a defence against the inverted/missing access-control flaw
- [Sharding](sharding.md) — RLS scopes rows within a shard; sharding splits data across databases
- [Secrets Management](secrets-management.md) — the session context value must come from trusted identity, never client input

---

## Key Takeaways

> Row Level Security enforces row-level access control inside PostgreSQL, so a query can never return or modify rows outside the current session's policy. It is the defense-in-depth backstop for shared-schema [Multi-Tenancy](multi-tenancy.md): even a code path that forgets `WHERE tenant_id` cannot cross tenant boundaries. Enable RLS on the table, create a policy that reads the tenant from `current_setting('app.current_tenant')`, and set that context per transaction with `SET LOCAL`. It is not a substitute for authentication or endpoint authorization — it guarantees *which rows* are visible, not *whether* a user may access a resource at all.
