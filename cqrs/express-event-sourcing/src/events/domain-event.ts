// Base contract for all events in the event-sourced system.
// Every event identifies which aggregate it belongs to and its
// position (version) in the event stream for optimistic concurrency.
export interface DomainEvent {
  eventType: string;
  aggregateId: string;
  version: number;
}
