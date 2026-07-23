# Database Migrations (Zero-Downtime)

> Evolving database schemas in production without downtime, broken queries, or rollback nightmares.

---

## What is it?

**Database migrations** are version-controlled, repeatable scripts that transform a database schema from one state to the next. **Zero-downtime migrations** follow a pattern — expand, migrate, contract — so the schema remains compatible with both old and new application code at every step, avoiding deployment locks or maintenance windows.

---

## Problem

Schema changes in production are risky:

- **Adding a NOT NULL column** — existing rows lack the value, INSERT fails for old code
- **Renaming a column** — old code still queries the old name, queries fail mid-deploy
- **Changing a column type** — old code sends the old type, INSERT breaks
- **Removing a column** — old code still references it, queries fail
- **Rollback coordination** — if a deploy fails, the schema change must be rolled back too

Without zero-downtime patterns, teams resort to maintenance windows or deploy freezes.

---

## Example

**Bad approach** — breaking change mid-deploy:

```sql
-- Step 1: Deploy new code that queries "total_amount" instead of "amount"
-- Step 2: Run migration
ALTER TABLE orders RENAME COLUMN amount TO total_amount;
-- During step 2 → all in-flight old code referencing "amount" breaks
```

**Zero-downtime approach** — expand-migrate-contract:

```sql
-- Phase 1 (deploy): Add the new column alongside the old one
ALTER TABLE orders ADD COLUMN total_amount DECIMAL(10,2);
UPDATE orders SET total_amount = amount;      -- backfill existing rows

-- Phase 2 (migrate): Deploy code that writes to both columns,
-- reads from "total_amount". Old code still reads/writes "amount".

-- Phase 3 (cleanup): Remove the old column
ALTER TABLE orders DROP COLUMN amount;
-- Only after every instance has deployed the new code
```

---

## Architecture / Flow

```text
Expand                          Migrate                         Contract
  │                               │                               │
  ▼                               ▼                               ▼
Add column                    Write both,                     Drop old
(nullable)                    read new                        column
  │                               │                               │
  │  Deploy v1.1                  │  Deploy v1.2                  │  Deploy v2.0
  │  (reads old + new)            │  (reads new only)             │  (cleanup only)
  ▼                               ▼                               ▼
┌─────────┐                   ┌─────────┐                    ┌─────────┐
│ amount  │                   │ amount  │                    │         │
│ total_  │ ← nullable        │ total_  │ ← populated        │ total_  │
│ amount  │   new column      │ amount  │   by dual-write    │ amount  │
└─────────┘                   └─────────┘                    └─────────┘
```

---

## Zero-Downtime Migration Patterns

| Change | Safe Pattern | Steps |
|--------|-------------|-------|
| **Add a column** (nullable, with default) | Expand only | `ALTER TABLE ADD COLUMN` — old code ignores it |
| **Add a NOT NULL column** | Expand → backfill → add constraint | Add nullable, backfill existing rows, `ALTER COLUMN SET NOT NULL` |
| **Rename a column** | Expand → migrate → contract | Add new column → dual-write → drop old column |
| **Change a column type** | Expand → migrate → contract | Add new column with new type → dual-write → drop old column |
| **Remove a column** | Migrate → contract | Stop reading in code first, then `ALTER TABLE DROP COLUMN` |
| **Add a table** | Expand only | CREATE TABLE — old code never references it |
| **Remove a table** | Migrate → contract | Stop writing in code first, then `DROP TABLE` |

---

## How it Works

1. **Expand** — add new columns/tables as nullable or with defaults. Old code continues to work unchanged. Deploy this change.
2. **Backfill** — populate existing rows for the new column (batched, low-context).
3. **Migrate** — deploy application code that writes to both old and new columns, reads from the new one. Old version still works.
4. **Contract** — after all instances are on the new code and the old column has no readers, drop it in a separate deploy.

---

## Node.js / Prisma Example

**Expand** — add column without breaking existing code:

```prisma
model Order {
  id          String   @id @default(uuid())
  amount      Decimal
  totalAmount Decimal? // new, nullable — old code ignores it
}
```

```bash
npx prisma migrate dev --name add_total_amount
```

**Migrate** — update application code to dual-write and read from new column:

```typescript
async function createOrder(data: CreateOrderInput) {
  return await prisma.order.create({
    data: {
      amount: data.total,             // write old (backward compat)
      totalAmount: data.total,        // write new
    }
  });
}

// read from new column only
async function getOrder(id: string) {
  return await prisma.order.findUnique({
    where: { id },
    select: { id: true, totalAmount: true }
  });
}
```

**Contract** — after all instances are on the new code, remove the old column:

```prisma
model Order {
  id          String   @id @default(uuid())
  totalAmount Decimal  // amount column removed
}
```

---

## Migration File Structure

```text
migrations/
  ├── 001_create_orders.sql
  ├── 002_add_total_amount.sql
  ├── 003_backfill_total_amount.sql
  ├── 004_drop_amount_column.sql
  └── ...
```

Each migration is:
- **Idempotent** — safe to run multiple times (uses `IF NOT EXISTS` / `IF EXISTS`)
- **Reversible** — has a corresponding `down` migration for rollback
- **Versioned** — applied in order, tracked in a `_migrations` table

---

## Rollback Strategy

```typescript
// migration 004_drop_amount_column (up)
ALTER TABLE orders DROP COLUMN amount;

// migration 004_drop_amount_column (down)
ALTER TABLE orders ADD COLUMN amount DECIMAL(10,2);
UPDATE orders SET amount = total_amount;
```

Rollback sequence:
1. Run the `down` migration (restore old column, backfill from new column)
2. Deploy the old application code
3. The old code now reads from `amount` again

---

## Advantages

- **Zero downtime** — no maintenance windows, no deploy coordination
- **Safe rollback** — every migration has a reversible `down` script
- **Continuous delivery** — deploy at any time without blocking other teams
- **Testing confidence** — migrations are version-controlled and run in CI

---

## Trade-offs

- **Migration debt** — multiple phases across deploys take days or weeks to complete
- **Dual-write complexity** — application code must write to both old and new columns temporarily
- **Long-lived branches** — a migration in progress blocks other schema changes on the same table
- **Backfill performance** — large tables need batched backfills to avoid locking

---

## When to Use

- Production databases with live traffic
- Any schema change that cannot tolerate downtime
- Systems where multiple application versions run simultaneously (rolling deploys, blue-green)

---

## When NOT to Use

- Development/staging environments — run simple migrations, no need for multi-phase
- Trivial changes (adding an index) — expand only, no migration needed
- Databases with scheduled maintenance windows — if downtime is acceptable, simplify

---

## Related Concepts

- [Database Concurrency Control](database-concurrency-control.md) — transaction isolation and locking during migrations
- [Replication](replication.md) — schema changes on replicas must follow the same expand-migrate-contract pattern
- [Rollout Strategies](rollout-strategies.md) — coordinate application deploys with migration phases

---

## Key Takeaways

> Zero-downtime migrations follow expand-migrate-contract: add the new structure, dual-write during the transition, then remove the old structure. Every change must be backward compatible with the running application code. Every migration must have a reversible `down` script. This pattern avoids deploy coordination, maintenance windows, and rollback nightmares.
