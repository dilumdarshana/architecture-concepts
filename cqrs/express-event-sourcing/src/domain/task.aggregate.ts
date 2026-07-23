import { TaskCreatedEvent } from '../events/task-created.event';
import { TaskStatusUpdatedEvent } from '../events/task-status-updated.event';
import { TaskStatus } from './task.status';
import { DomainEvent } from '../events/domain-event';

// Snapshot of the current state reconstructed from the event stream.
// This is what query handlers return — never stored directly.
export interface TaskState {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: Date;
}

// Event-sourced aggregate root for the Task domain.
//
// Instead of persisting state, every mutation produces an event.
// The current state is rebuilt by replaying the event stream
// through apply(). This allows full audit history and temporal queries.
export class TaskAggregate {
  private state: TaskState | null = null;

  // Tracks the version of the last applied event.
  // Used for optimistic concurrency when appending new events.
  private currentVersion = 0;

  get id(): string | undefined {
    return this.state?.id;
  }

  get stateVersion(): number {
    return this.currentVersion;
  }

  getSnapshot(): TaskState | null {
    return this.state ? { ...this.state } : null;
  }

  // Factory: produces a TaskCreatedEvent as the first event in the stream.
  // expectedVersion for the event store will be 0 (new aggregate).
  static create(id: string, title: string): { aggregate: TaskAggregate; event: TaskCreatedEvent } {
    if (!title || title.trim().length < 3) {
      throw new Error('Task title must be at least 3 characters');
    }

    const aggregate = new TaskAggregate();
    const event = new TaskCreatedEvent(id, title.trim(), 'OPEN', new Date());
    aggregate.apply(event);
    return { aggregate, event };
  }

  // Produces a TaskStatusUpdatedEvent. Requires the aggregate to
  // have been initialized (via create or replay).
  updateStatus(newStatus: TaskStatus): TaskStatusUpdatedEvent {
    if (!this.state) {
      throw new Error('Task not found');
    }

    const event = new TaskStatusUpdatedEvent(this.state.id, newStatus, new Date());
    this.apply(event);
    return event;
  }

  // Rebuilds aggregate state from a sequence of historical events.
  // Called by the command handler when loading an existing aggregate.
  replay(events: DomainEvent[]): void {
    for (const event of events) {
      this.apply(event);
    }
  }

  // Core event application logic. Each event type mutates state
  // in a deterministic way. This is the only place state changes.
  private apply(event: DomainEvent): void {
    switch (event.eventType) {
      case 'TaskCreatedEvent': {
        const e = event as TaskCreatedEvent;
        this.state = {
          id: e.aggregateId,
          title: e.title,
          status: e.status as TaskStatus,
          createdAt: e.createdAt,
        };
        break;
      }
      case 'TaskStatusUpdatedEvent': {
        const e = event as TaskStatusUpdatedEvent;
        if (this.state) {
          this.state = { ...this.state, status: e.status };
        }
        break;
      }
    }
    this.currentVersion = event.version;
  }
}
