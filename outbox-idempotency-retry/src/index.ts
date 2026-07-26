import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import ordersRouter from './routes/orders';
import { startOutboxPoller, stopOutboxPoller } from './services/outboxPoller';
import { startWorker, stopWorker } from './workers';
import { orderQueue } from './queue';
import { prisma } from './db';

const app = express();

// Bull Board — web UI for inspecting queues (http://localhost:4000/admin/queues)
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(orderQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
app.use(express.json());
app.use('/api', ordersRouter);

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  await prisma.$connect();
  console.log('Database connected');

  // Start the BullMQ worker (pulls jobs from Redis and processes them)
  await startWorker();

  // Start the outbox poller (reads unprocessed OutboxEvent rows
  // and publishes them to BullMQ on a 2-second interval)
  startOutboxPoller();

  const server = app.listen(PORT, () => {
    console.log(`Server listening on :${PORT}`);
  });

  // Graceful shutdown: stop accepting new requests, drain the poller,
  // let the worker finish its current jobs, then close DB connections.
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down...`);

    server.close(() => {
      console.log('HTTP server closed');
    });

    stopOutboxPoller();
    await stopWorker();
    await prisma.$disconnect();

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
