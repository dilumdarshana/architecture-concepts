import './tracing';
import express from 'express';
import paymentRoutes from './routes/payments';

const app = express();
const PORT = 3001;

app.use(express.json());
app.use('/payments', paymentRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

const server = app.listen(PORT, () => {
  console.log(`[payment-service] listening on port ${PORT}`);
});

function shutdown(signal: string) {
  console.log(`\n[payment-service] ${signal} received — shutting down...`);
  server.close(() => {
    console.log('[payment-service] closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[payment-service] forced exit after timeout');
    process.exit(1);
  }, 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
