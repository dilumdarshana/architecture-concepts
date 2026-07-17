# Idempotency

> An operation is idempotent if applying it multiple times produces the same result as applying it once.

---

## What is it?

**Idempotency** guarantees that a request can be safely retried without causing unintended side effects. An **idempotency key** is a unique identifier the client sends with a request — the server uses it to recognize and reject duplicates.

When a client sends the same idempotency key with multiple requests, the server processes the first one and returns the cached result for all subsequent ones.

---

## Problem

In distributed systems, network failures are inevitable. A client sends a request, the server processes it successfully, but the response is lost in transit. The client has no way to know whether the operation succeeded, so it retries. Without idempotency:

- **Payment** — a customer is charged twice for the same order.
- **Order creation** — duplicate orders are created from a single checkout.
- **Inventory** — the same item is deducted from stock multiple times.

This is the **retry ambiguity problem**: the caller cannot distinguish between "the server never received my request" and "the server processed my request but the response was lost."

---

## Example

A real-world analogy — an elevator call button:

```text
Without idempotency:
  Press "call"    →  Elevator arrives
  Press "call"    →  Second elevator arrives (duplicate!)

With idempotency:
  Press "call"    →  "Call" lights up, elevator arrives
  Press "call"    →  Button is already lit (no duplicate)
```

In an API, the client generates a unique idempotency key (UUID) and includes it in the request header:

```text
POST /payments
Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890
{
  "amount": 99.99,
  "currency": "USD"
}
```

The server stores the key with the result. If the same key arrives again, the server returns the stored result without processing the request again.

```typescript
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function chargePayment(
  idempotencyKey: string,
  customerId: string,
  amount: number
) {
  // Check for existing result in the same atomic scope
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.idempotencyKey.findUnique({
      where: { key: idempotencyKey }
    });

    if (existing) {
      // Duplicate — return cached result
      return existing.result;
    }

    // First attempt — perform the operation
    const charge = await stripe.charges.create({
      customer: customerId,
      amount,
      currency: 'usd'
    });

    // Store the result keyed by idempotency key
    await tx.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        result: charge.id
      }
    });

    return charge.id;
  });
}

// Client generates a key once and retries safely
app.post('/payments', async (req, res) => {
  const key = req.headers['idempotency-key'] as string ?? randomUUID();
  const result = await chargePayment(key, req.body.customerId, req.body.amount);
  res.json({ chargeId: result });
});
```

---

## Architecture / Flow

```text
Client                          Server
  │                                │
  │  POST /payments                │
  │  Idempotency-Key: K1           │
  │──────────────────────────────►│
  │                                │  Check idempotency table
  │                                │  ─► key K1 not found
  │                                │
  │                                │  Process payment
  │                                │  Store result with key K1
  │                                │
  │◄──────────────────────────────│  200 OK { chargeId: "ch_123" }
  │                                │
  │  POST /payments (retry)        │
  │  Idempotency-Key: K1           │
  │──────────────────────────────►│
  │                                │  Check idempotency table
  │                                │  ─► key K1 found
  │                                │  Return cached result
  │◄──────────────────────────────│  200 OK { chargeId: "ch_123" }
  │                                │
```

The idempotency table stores key-result pairs with an expiration (e.g. 24 hours) to prevent unbounded growth:

```sql
CREATE TABLE idempotency_keys (
  key        UUID PRIMARY KEY,
  result     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_idempotency_keys_created_at
  ON idempotency_keys (created_at);
```

---

## How it Works

1. Client generates a unique idempotency key (UUID v4) before sending the request.
2. Client includes the key in the request header (`Idempotency-Key`) and sends the request.
3. Server begins a database transaction and looks up the key in the idempotency table.
4. If the key exists, the server returns the stored result immediately (no operation performed).
5. If the key does not exist, the server executes the business logic (charge, order creation, etc.).
6. Server stores the result under the idempotency key within the same transaction.
7. Server commits the transaction and returns the result to the client.
8. Client retries on network failure — the same key ensures the operation is not duplicated.
9. Expired keys are cleaned up periodically to reclaim storage.

---

## Advantages

- **Safe retries** — clients can retry on network failures without side effects
- **Exactly-once semantics** — the combination of idempotency key + deduplication provides at-most-once processing with at-least-once delivery
- **Simple for clients** — client generates a UUID once and does not need complex retry logic
- **Audit trail** — the idempotency table records every unique request attempt
- **Composable** — works alongside [Outbox Pattern](outbox-pattern.md) and transactions for end-to-end reliability

---

## Trade-offs

- **Storage overhead** — idempotency keys must be stored with results, requiring cleanup of expired entries
- **Key management** — clients must generate and persist keys across retries; losing the key breaks idempotency
- **Operational cost** — every request incurs an extra lookup in the idempotency table
- **Not all operations are idempotent** — some operations (e.g. append to a log, send email) cannot be made idempotent at the application level
- **Time-bounded** — keys typically expire (e.g. 24 hours), so long-delayed retries may not be deduplicated

---

## When to Use

- Payment processing, order creation, and any operation that has financial or irreversible side effects
- APIs exposed to unreliable networks (mobile apps, IoT, third-party integrations)
- Services that use retry-based reliability patterns (circuit breakers, message queue retries)
- Any operation where duplicates would cause data corruption or incorrect state

---

## When NOT to Use

- Read-only operations (GET requests are naturally idempotent)
- Operations where the client does not control the retry (e.g. internal service-to-service calls with at-most-once delivery)
- Systems where the cost of the idempotency lookup outweighs the risk of duplicates
- Append-only logs or event streams where duplicates are handled downstream via deduplication

---

## Related Concepts

- [Outbox Pattern](outbox-pattern.md) — uses idempotency in the publishing process to prevent duplicate event delivery
- [Distributed Systems](distributed-systems.md) — retry ambiguity is a core challenge in network-bound systems
- [Database Concurrency Control](database-concurrency-control.md) — idempotency keys rely on transactional atomicity for safe deduplication
- Retry Pattern
- Circuit Breaker
- Exactly-Once Delivery
- UUID

---

## Key Takeaways

> Idempotency allows clients to retry requests without risking duplicate side effects. An idempotency key (client-generated UUID) is stored with the operation result — subsequent requests with the same key return the cached result instead of re-executing. This is essential for payments, order creation, and any operation where duplicates are unacceptable.
