import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { orderQueue } from '../queue';

const router: Router = Router();

interface CreateOrderBody {
  customerId: string;
  total: number;
  items: { productId: string; quantity: number }[];
}

// POST /api/orders
//
// Writes the order and an outbox event in a single Prisma $transaction
// (atomic dual-write). The outbox poller will later publish the event
// to BullMQ, so we never write to the queue directly from the HTTP handler.
//
// Idempotency-Key header:
//   Clients can provide a unique key (e.g. UUID) to make the endpoint
//   idempotent. If the same key arrives with an identical body, the
//   cached 201 response is returned and no new order is created.
//   If the same key arrives with a different body, the request is
//   rejected with 409 Conflict.
//
// Query params:
//   ?fail=true — marks the outbox payload so the consumer throws,
//                triggering BullMQ's retry mechanism (3 attempts).
router.post('/orders', async (req: Request, res: Response) => {
  const { customerId, total, items } = req.body as CreateOrderBody;
  const fail = req.query.fail === 'true';
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  // Compute SHA-256 of the body to detect key reuse with a different payload
  const bodyHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

  if (idempotencyKey) {
    const existing = await prisma.idempotencyRequest.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      if (existing.bodyHash === bodyHash) {
        // Same key, same body → return cached response
        res.status(201).json(existing.response as { orderId: string; fail: boolean });
        return;
      }
      // Same key, different body → reject
      res.status(409).json({
        error: 'Idempotency key already used with a different request body',
      });
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    // 1. Insert the business entity
    const order = await tx.order.create({
      data: { customerId, total },
    });

    // 2. Insert an outbox row in the same transaction
    //    (no dual-write risk — if this fails, the order is rolled back too)
    await tx.outboxEvent.create({
      data: {
        eventType: 'OrderCreated',
        aggregateId: order.id,
        aggregateType: 'order',
        version: 1,
        payload: { orderId: order.id, customerId, total, items, fail },
      },
    });

    const response = { orderId: order.id, fail };

    // 3. Record the idempotency key in the same transaction so the
    //    order, outbox event, and key are committed atomically.
    if (idempotencyKey) {
      await tx.idempotencyRequest.create({
        data: { key: idempotencyKey, bodyHash, response },
      });
    }

    res.status(201).json(response);
  });
});

export default router;
