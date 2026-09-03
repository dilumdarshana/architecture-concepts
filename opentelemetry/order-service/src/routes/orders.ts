import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const router: Router = Router();
const prisma = new PrismaClient();

// Get a named tracer — all spans created by this tracer are grouped
// under "order-service" in the Jaeger UI.
const tracer = trace.getTracer('order-service');

// POST /orders — creates an order, inserts into DB, calls payment service.
//
// Trace flow:
//   create-order (root span)
//     ├── insert-order (child span — DB write)
//     ├── call-payment-service (child span — HTTP call to payment-service)
//     │     └── process-payment (child span on payment-service)
//     │           └── charge-card (child span — simulated work)
//     └── order.status = "paid"
router.post('/', async (req, res) => {
  // Root span for this request — ends in the finally block.
  const span = tracer.startSpan('create-order');

  try {
    const { productId, quantity } = req.body;

    // Attach metadata to the span — visible in Jaeger's span detail view.
    span.setAttribute('product.id', productId);
    span.setAttribute('order.quantity', quantity);

    // startActiveSpan runs the callback within the span's context,
    // so any HTTP calls or child spans created inside are automatically
    // linked as children of this span.
    const order = await tracer.startActiveSpan('insert-order', async (dbSpan) => {
      const result = await prisma.order.create({
        data: { productId, quantity: Number(quantity) },
      });
      dbSpan.setAttribute('order.id', result.id);
      dbSpan.end();
      return result;
    });

    // HTTP call to payment-service — the HttpInstrumentation automatically
    // injects the traceparent header into this outgoing request.
    // The payment-service picks it up and continues the same trace.
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

    // Update order status after successful payment.
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'paid' },
    });

    // Mark span as successful — Jaeger shows this as a green status.
    span.setStatus({ code: SpanStatusCode.OK });
    res.status(201).json({ order, payment });
  } catch (err) {
    // Mark span as failed — Jaeger shows this as a red status.
    // recordException attaches the error stack trace to the span.
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    span.recordException(err as Error);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    // Always end the span — even if the request fails.
    // Missing span.end() causes memory leaks and incomplete traces.
    span.end();
  }
});

// GET /orders/:id — fetches an order with its payments.
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
