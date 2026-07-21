import { applicationEvents } from '../events/applicationEvents';

/**
 * Registers a listener for the "order:created" event.
 * In a real application this would call a push notification provider (FCM, APNs, etc.).
 */
export function setupNotificationService() {
  applicationEvents.on('order:created', ({ orderId }) => {
    // Simulate async push notification dispatch — runs as fire-and-forget
    setImmediate(() => {
      console.log(`[notificationService] Sending push notification for order ${orderId}...`);
    });
  });

  console.log('[notificationService] Listener registered');
}
