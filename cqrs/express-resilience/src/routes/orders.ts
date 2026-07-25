import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { orderQueue } from '../queue';

const router: Router = Router();

interface CreateOrderBody {
  customerId: string;
  total: number;
  items: { productId: string; quantity: number }[];
}

router.post('/orders', async (req: Request, res: Response) => {
  const { customerId, total, items } = req.body as CreateOrderBody;

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { customerId, total },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: 'OrderCreated',
        aggregateId: order.id,
        aggregateType: 'order',
        version: 1,
        payload: { orderId: order.id, customerId, total, items },
      },
    });

    res.status(201).json({ orderId: order.id });
  });
});

export default router;
