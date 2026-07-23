import { DomainEvent } from './domain-event';

type EventHandler<T extends DomainEvent> = (event: T) => Promise<void>;

// Simple in-memory pub/sub event bus.
//
// After a command handler appends events to the store, it publishes
// them on this bus so projections can update the read models.
// In production this would be replaced with a message queue (RabbitMQ,
// Kafka, etc.) for durability and horizontal scaling.
export class EventBus {
  private handlers = new Map<string, EventHandler<any>[]>();

  subscribe<T extends DomainEvent>(
    eventName: string,
    handler: EventHandler<T>,
  ): void {
    const existing = this.handlers.get(eventName) || [];
    this.handlers.set(eventName, [...existing, handler]);
  }

  async publish<T extends DomainEvent>(
    eventName: string,
    event: T,
  ): Promise<void> {
    const handlers = this.handlers.get(eventName) || [];
    for (const handler of handlers) {
      await handler(event);
    }
  }
}
