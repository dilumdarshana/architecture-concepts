import { Queue, Worker } from 'bullmq';

const connection = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT) || 6379 };

const JOB_NAME = 'process-order';

export const orderQueue = new Queue(JOB_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export function createWorker(handler: (job: any) => Promise<void>) {
  return new Worker(JOB_NAME, handler, {
    connection,
    concurrency: 5,
  });
}
