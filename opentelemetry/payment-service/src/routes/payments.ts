import { Router, Request, Response } from 'express';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const router: Router = Router();

// Named tracer — shows as "payment-service" in Jaeger.
const tracer = trace.getTracer('payment-service');

// POST /payments — receives a payment request from order-service.
//
// The traceparent header (sent by order-service) is picked up automatically
// by the HttpInstrumentation, so this span appears as a child of
// order-service's "call-payment-service" span in the trace waterfall.
router.post('/', async (req, res) => {
  const span = tracer.startSpan('process-payment');

  try {
    const { orderId, amount } = req.body;
    span.setAttribute('order.id', orderId);
    span.setAttribute('payment.amount', amount);

    // Simulate an async payment operation (e.g. calling a payment gateway).
    // startActiveSpan ensures this child span is linked to the parent.
    await tracer.startActiveSpan('charge-card', async (chargeSpan) => {
      chargeSpan.setAttribute('payment.method', 'credit_card');
      await new Promise((resolve) => setTimeout(resolve, 50));
      chargeSpan.end();
    });

    const payment = {
      id: `pay-${Date.now()}`,
      orderId,
      amount,
      status: 'completed',
    };

    span.setStatus({ code: SpanStatusCode.OK });
    res.status(201).json(payment);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
    span.recordException(err as Error);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    span.end();
  }
});

export default router;
