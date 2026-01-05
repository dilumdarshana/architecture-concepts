import { PgTaskReadRepository } from '../../infrastructure/repositories/task-read.repo.pg';
import { GetTaskQuery } from './get-task.query';

export class GetTaskHandler {
  constructor(
    private readonly taskReadRepo: PgTaskReadRepository
  ) { }

  async execute(query: GetTaskQuery) {
    return this.taskReadRepo.findById(query.id);
  }
}
