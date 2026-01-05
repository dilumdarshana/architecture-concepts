import { PgTaskReadRepository } from '../infrastructure/repositories/task-read.repo.pg';
import { TaskStatusUpdatedEvent } from '../events/task-status-updated.event';

export class TaskStatusUpdatedProjection {
  constructor(
    private readonly taskReadRepo: PgTaskReadRepository
  ) { }

  async handle(event: TaskStatusUpdatedEvent) {
    await this.taskReadRepo.updateStatus(
      event.taskId,
      event.status
    );
  }
}
