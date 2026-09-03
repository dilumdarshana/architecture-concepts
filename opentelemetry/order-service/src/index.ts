import './tracing';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import orderRoutes from './routes/orders';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use('/orders', orderRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

const prisma = new PrismaClient();

const server = app.listen(PORT, () => {
  console.log(`[order-service] listening on port ${PORT}`);
});

function shutdown(signal: string) {
  console.log(`\n[order-service] ${signal} received — shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log('[order-service] closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[order-service] forced exit after timeout');
    process.exit(1);
  }, 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
