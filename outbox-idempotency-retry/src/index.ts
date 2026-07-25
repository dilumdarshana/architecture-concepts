import express from 'express';
import ordersRouter from './routes/orders';
import { startOutboxPoller, stopOutboxPoller } from './services/outboxPoller';
import { startWorker, stopWorker } from './workers';
import { prisma } from './db';

const app = express();
app.use(express.json());
app.use('/api', ordersRouter);

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  await prisma.$connect();
  console.log('Database connected');

  await startWorker();
  startOutboxPoller();

  const server = app.listen(PORT, () => {
    console.log(`Server listening on :${PORT}`);
  });

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
