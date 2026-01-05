import { TaskCreatedEvent } from '../events/task-created.event';
import { PgTaskReadRepository } from '../infrastructure/repositories/task-read.repo.pg';

export class TaskCreatedProjection {
  constructor(
    private readonly taskReadRepo: PgTaskReadRepository
  ) { }

  async handle(event: TaskCreatedEvent) {
    await this.taskReadRepo.insert({
      id: event.id,
      title: event.title,
      status: event.status,
      created_at: event.createdAt
    });
  }
}
