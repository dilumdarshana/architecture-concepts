import { PgTaskReadRepository } from '../infrastructure/repositories/task-read.repo.pg';
import { TaskStatusUpdatedEvent } from '../events/task-status-updated.event';

// Projection: listens for TaskStatusUpdatedEvent and syncs the read model.
// Without this projection, the read DB would be stale after a status change.
export class TaskStatusUpdatedProjection {
  constructor(
    private readonly taskReadRepo: PgTaskReadRepository,
  ) {}

  async handle(event: TaskStatusUpdatedEvent): Promise<void> {
    await this.taskReadRepo.updateStatus(event.aggregateId, event.status);
  }
}
