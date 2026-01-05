type EventHandler<T> = (event: T) => Promise<void>;

export class EventBus {
  private handlers = new Map<string, EventHandler<any>[]>();

  subscribe<T>(
    eventName: string,
    handler: EventHandler<T>
  ) {
    const existing = this.handlers.get(eventName) || [];
    this.handlers.set(eventName, [...existing, handler]);
  }

  async publish<T>(
    eventName: string,
    event: T,
  ) {
    const handlers = this.handlers.get(eventName) || [];

    for (const handler of handlers) {
      await handler(event);
    }
  }
}
