import { GetTaskQuery } from './get-task.query';
import { PgTaskReadRepository } from '../../infrastructure/repositories/task-read.repo.pg';

// Query handler — reads from the denormalized task_view table.
// No events are produced. The read model is kept fresh by projections.
export class GetTaskHandler {
  constructor(
    private readonly taskReadRepo: PgTaskReadRepository,
  ) {}

  async execute(query: GetTaskQuery) {
    return this.taskReadRepo.findById(query.id);
  }
}
