import express from 'express';
import { applicationEvents } from './events/applicationEvents';
import { setupEmailService } from './services/emailService';
import { setupNotificationService } from './services/notificationService';
import orderRoutes from './routes/orderRoutes';

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());

// Register event listeners (decoupled from the business logic)
setupEmailService();
setupNotificationService();

// Routes
app.use('/orders', orderRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Graceful shutdown — remove all event listeners to prevent memory leaks
// and ensure clean restarts (especially important in tests and hot-reload dev).
function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down...`);

  // Remove ALL listeners from the shared EventEmitter
  applicationEvents.removeAllListeners();

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced exit after timeout');
    process.exit(1);
  }, 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
