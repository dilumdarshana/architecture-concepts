import { prisma } from '../db';

interface OrderPayload {
  orderId: string;
  customerId: string;
  total: number;
  items: { productId: string; quantity: number }[];
}

export async function processOrder(job: { id: string; data: { id: string; aggregateId: string; payload: OrderPayload } }) {
  const { id: jobId, data } = job;
  const idempotencyKey = jobId;

  const existing = await prisma.processedMessage.findUnique({
    where: { idempotencyKey },
  });

  if (existing) {
    console.log(`Duplicate job ${jobId} skipped`);
    return;
  }

  const { aggregateId: orderId, payload } = data;

  console.log(`Processing order ${orderId}...`);

  await prisma.processedMessage.create({
    data: {
      id: jobId,
      idempotencyKey,
      status: 'completed',
    },
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'confirmed' },
  });

  console.log(`Order ${orderId} confirmed`);
}
