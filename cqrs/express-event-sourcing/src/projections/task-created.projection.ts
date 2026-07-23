import { TaskCreatedEvent } from '../events/task-created.event';
import { PgTaskReadRepository } from '../infrastructure/repositories/task-read.repo.pg';

// Projection: listens for TaskCreatedEvent and inserts a row into task_view.
//
// Projections are the bridge between the event-sourced write side and the
// denormalized read side. They can be rebuilt from scratch by replaying
// all historical events from the event store.
export class TaskCreatedProjection {
  constructor(
    private readonly taskReadRepo: PgTaskReadRepository,
  ) {}

  async handle(event: TaskCreatedEvent): Promise<void> {
    await this.taskReadRepo.insert({
      id: event.aggregateId,
      title: event.title,
      status: event.status,
      created_at: event.createdAt,
    });
  }
}
