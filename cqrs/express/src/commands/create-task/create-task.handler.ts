import { CreateTaskCommand } from './create-task.command';
import { TaskWriteRepository } from '../../infrastructure/repositories/task-write.repo';
import { Task } from '../../domain/task.entity';

export class CreateTaskHandler {
  constructor(
    private readonly taskWriteRepo: TaskWriteRepository
  ) { }

  async execute(command: CreateTaskCommand): Promise<void> {
    const task = Task.create(command.title);

    await this.taskWriteRepo.save(task);

    // IMPORTANT:
    // - No return value
    // - No read model access
    // - No events yet
  }
}
