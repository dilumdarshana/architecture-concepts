import { applicationEvents } from '../events/applicationEvents';

/**
 * Registers a listener for the "order:created" event.
 * In a real application this would call an email provider (SendGrid, SES, etc.).
 */
export function setupEmailService() {
  applicationEvents.on('order:created', ({ orderId }) => {
    // Simulate async email dispatch — runs as fire-and-forget
    setImmediate(() => {
      console.log(`[emailService] Sending confirmation for order ${orderId}...`);
    });
  });

  console.log('[emailService] Listener registered');
}
