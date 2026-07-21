import { EventEmitter } from 'events';

// Type-safe event map — defines which events can be emitted and their payload types
export interface ApplicationEvents {
  'order:created': { orderId: string; productId: string; quantity: number };
  'order:failed':   { error: Error; productId: string };
  'error':          { error: Error };
}

// Declare the EventEmitter so that emit(...) is type-checked
export interface TypedEventEmitter {
  on<K extends keyof ApplicationEvents>(event: K, listener: (payload: ApplicationEvents[K]) => void): this;
  once<K extends keyof ApplicationEvents>(event: K, listener: (payload: ApplicationEvents[K]) => void): this;
  emit<K extends keyof ApplicationEvents>(event: K, payload: ApplicationEvents[K]): boolean;
  removeAllListeners(event?: string): this;
}

// Single, shared EventEmitter instance used across the application
class AppEventEmitter extends EventEmitter {}
const applicationEvents = new AppEventEmitter() as TypedEventEmitter;

// Global error handler for the EventEmitter — prevents process crash on unhandled errors
applicationEvents.on('error', ({ error }) => {
  console.error('[eventBus] Unhandled error:', error.message);
});

export { applicationEvents, AppEventEmitter };
