import { DomainEvent } from './domain-event';

// Emitted when a new task is created. This is the first event in
// every Task aggregate's event stream (version 1).
// Stored as JSONB in the event_store table and replayed by TaskAggregate.
export class TaskCreatedEvent implements DomainEvent {
  readonly eventType = 'TaskCreatedEvent';

  constructor(
    public readonly aggregateId: string,
    public readonly title: string,
    public readonly status: string,
    public readonly createdAt: Date,
    // version is set by the event store at append time, not by the caller
    public readonly version: number = 0,
  ) {}
}
