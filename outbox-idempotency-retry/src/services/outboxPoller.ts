import { prisma } from '../db';
import { orderQueue } from '../queue';

// Polls the outbox table every 2 seconds for unprocessed events
// and publishes them to BullMQ. This decouples the HTTP handler
// from the queue — the handler only writes to the DB.
//
// If the queue is temporarily unavailable, events stay in the
// outbox table and will be picked up on the next poll cycle.
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
      // Fetch the oldest unprocessed events (FIFO order)
      const events = await prisma.outboxEvent.findMany({
        where: { processedAt: null },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        // Publish to BullMQ — use event.id as jobId for idempotency
        await orderQueue.add(
          event.eventType,
          { id: event.id, aggregateId: event.aggregateId, payload: event.payload },
          { jobId: event.id }
        );

        // Mark as processed so the next poll skips it
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date() },
        });
      }
    } catch (err) {
      // Log and continue — don't crash the poller on transient errors
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
