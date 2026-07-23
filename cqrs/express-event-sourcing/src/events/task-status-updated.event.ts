import { DomainEvent } from './domain-event';
import { TaskStatus } from '../domain/task.status';

// Emitted when an existing task's status changes (e.g. OPEN → IN_PROGRESS).
// Appended to the aggregate's event stream at the next available version.
export class TaskStatusUpdatedEvent implements DomainEvent {
  readonly eventType = 'TaskStatusUpdatedEvent';

  constructor(
    public readonly aggregateId: string,
    public readonly status: TaskStatus,
    public readonly updatedAt: Date,
    public readonly version: number = 0,
  ) {}
}
