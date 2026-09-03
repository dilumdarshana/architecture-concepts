import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const router: Router = Router();
const prisma = new PrismaClient();
const tracer = trace.getTracer('order-service');

router.post('/', async (req, res) => {
  const span = tracer.startSpan('create-order');

  try {
    const { productId, quantity } = req.body;
    span.setAttribute('product.id', productId);
    span.setAttribute('order.quantity', quantity);

    // Create order in database
    const order = await tracer.startActiveSpan('insert-order', async (dbSpan) => {
      const result = await prisma.order.create({
        data: { productId, quantity: Number(quantity) },
      });
      dbSpan.setAttribute('order.id', result.id);
      dbSpan.end();
      return result;
    });

    // Call payment service — trace context is propagated automatically
    const paymentServiceUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3001';
    const payment = await tracer.startActiveSpan('call-payment-service', async (paySpan) => {
      const response = await fetch(`${paymentServiceUrl}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, amount: 29.99 }),
      });

      if (!response.ok) {
        throw new Error(`Payment failed: ${response.status}`);
      }

      const data = (await response.json()) as { id: string };
      paySpan.setAttribute('payment.id', data.id);
      paySpan.end();
      return data;
    });

    // Update order status
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'paid' },
    });

    span.setStatus({ code: SpanStatusCode.OK });
    res.status(201).json({ order, payment });
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    span.recordException(err as Error);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    span.end();
  }
});

router.get('/:id', async (req, res) => {
  const span = tracer.startSpan('get-order');

  try {
    span.setAttribute('order.id', req.params.id);

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { payments: true },
    });

    if (!order) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Order not found' });
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    span.setStatus({ code: SpanStatusCode.OK });
    res.json(order);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    span.recordException(err as Error);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    span.end();
  }
});

export default router;
