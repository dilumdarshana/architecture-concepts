import { prisma } from '../db';
import { orderQueue } from '../queue';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 50;

let active = false;

export function startOutboxPoller() {
  if (active) return;
  active = true;
  poll();
}

async function poll() {
  while (active) {
    try {
      const events = await prisma.outboxEvent.findMany({
        where: { processedAt: null },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        await orderQueue.add(
          event.eventType,
          { id: event.id, aggregateId: event.aggregateId, payload: event.payload },
          { jobId: event.id }
        );

        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date() },
        });
      }
    } catch (err) {
      console.error('Outbox poller error:', err);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopOutboxPoller() {
  active = false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
