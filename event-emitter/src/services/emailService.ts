import { applicationEvents } from '../events/applicationEvents';

/**
 * Registers a listener for the "order:created" event.
 * In a real application this would call an email provider (SendGrid, SES, etc.).
 */
export function setupEmailService() {
  applicationEvents.on('order:created', ({ orderId }) => {
    // setImmediate defers the work to the next event loop iteration so the HTTP
    // response is not blocked. For production, use a message queue (BullMQ)
    // instead of setImmediate for important side effects (email, payments) —
    // the queue retries on failure and persists the message across restarts.
    setImmediate(() => {
      console.log(`[emailService] Sending confirmation for order ${orderId}...`);
    });
  });

  console.log('[emailService] Listener registered');
}
