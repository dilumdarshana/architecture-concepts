import { createWorker } from './queue';
import { processOrder } from './services/orderProcessor';
import { prisma } from './db';

// The singleton BullMQ worker. created here so start/stop and event
// handlers all share the same instance.
const worker = createWorker(async (job) => {
  await processOrder(job);
});

export async function startWorker() {
  await worker.waitUntilReady();
  console.log('Worker ready, waiting for jobs...');
}

export async function stopWorker() {
  console.log('Draining worker...');
  await worker.close();
  console.log('Worker drained');
}

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
});
