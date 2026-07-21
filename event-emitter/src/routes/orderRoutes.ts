import { Router, Request, Response } from 'express';
import { createOrder, listOrders } from '../services/orderService';

const router = Router();

// POST /orders — creates a new order (emits "order:created" internally)
router.post('/', (req: Request, res: Response) => {
  const { productId, quantity } = req.body;

  if (!productId || !quantity) {
    res.status(400).json({ error: 'productId and quantity are required' });
    return;
  }

  try {
    const order = createOrder(productId, quantity);
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET /orders — returns all orders (demonstrates a simple read path)
router.get('/', (_req: Request, res: Response) => {
  res.json(listOrders());
});

export default router;
