import { prisma } from '../db';

interface OrderPayload {
  orderId: string;
  customerId: string;
  total: number;
  items: { productId: string; quantity: number }[];
  fail?: boolean;
}

// Consumer handler called by BullMQ for each "process-order" job.
//
// Idempotency: checks ProcessedMessage by jobId before doing any work.
// If the same jobId was already processed (e.g. due to at-least-once
// delivery), the handler returns early without side effects.
//
// Retry test: when payload.fail is true, the handler throws so BullMQ
// retries the job (3 attempts with exponential backoff).
export async function processOrder(job: { id: string; data: { id: string; aggregateId: string; payload: OrderPayload } }) {
  const { id: jobId, data } = job;
  const idempotencyKey = jobId;

  // 1. Idempotency check — skip if already processed
  const existing = await prisma.processedMessage.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    console.log(`Duplicate job ${jobId} skipped`);
    return;
  }

  const { aggregateId: orderId, payload } = data;

  // 2. Simulated failure for retry testing
  if (payload.fail) {
    console.log(`Order ${orderId} simulating failure (retry attempt)...`);
    throw new Error('Simulated failure for retry test');
  }

  console.log(`Processing order ${orderId}...`);

  // 3. Record the idempotency key (marks the job as done)
  await prisma.processedMessage.create({
    data: {
      id: jobId,
      idempotencyKey,
      status: 'completed',
    },
  });

  // 4. Update the business entity
  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'confirmed' },
  });

  console.log(`Order ${orderId} confirmed`);
}
