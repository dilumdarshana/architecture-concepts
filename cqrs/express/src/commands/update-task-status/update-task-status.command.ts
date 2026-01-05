import { TaskStatus } from '../../domain/task.status';

export class UpdateTaskStatusCommand {
  constructor(
    public readonly taskId: string,
    public readonly status: TaskStatus
  ) { }
}
