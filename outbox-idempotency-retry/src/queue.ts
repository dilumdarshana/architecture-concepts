import { Queue, Worker } from 'bullmq';

// Redis connection — can be overridden via environment variables
// (useful when running against a cloud Redis or different port).
const connection = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT) || 6379 };

const JOB_NAME = 'process-order';

// BullMQ queue with built-in retry:
// - 3 attempts with exponential backoff (2s → 4s → 8s)
// - Completed/failed jobs are cleaned up after 100/50 entries
export const orderQueue = new Queue(JOB_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// Factory function so the caller can inject any handler
// (enables testing without coupling to a specific processor).
export function createWorker(handler: (job: any) => Promise<void>) {
  return new Worker(JOB_NAME, handler, {
    connection,
    concurrency: 5,
  });
}
